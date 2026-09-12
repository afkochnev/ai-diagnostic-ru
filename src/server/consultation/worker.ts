import { createAdminClient } from "@/server-runtime/supabase/admin";
import { buildConsultationNotification } from "./content";
import { getConsultationProvider } from "./provider";

type ClaimedJob = { job_id: string; lead_request_id: string; lease_token: string; attempt_count: number };
type SafeRpcError = { message?: string; code?: string; details?: string; hint?: string };

function claimError(error: SafeRpcError) {
  const result = new Error(`consultation_claim_failed:${error.message ?? "unknown"}`) as Error & SafeRpcError;
  result.name = "ConsultationClaimError";
  result.code = error.code;
  result.details = error.details;
  result.hint = error.hint;
  return result;
}

async function processClaimedJob(claim: ClaimedJob) {
  const db = createAdminClient();
  const { data: lead } = await db.from("lead_requests").select("id,company_id,name,email,contact_type,contact_value,comment,diagnostic_id").eq("id", claim.lead_request_id).maybeSingle();
  if (!lead) return { status: "missing" };
  const { data: currentDelivery } = await db.from("consultation_notification_deliveries").select("id,status").eq("lead_request_id", claim.lead_request_id).maybeSingle();
  if (!currentDelivery || currentDelivery.status === "sent") return { status: currentDelivery?.status ?? "missing" };
  await db.from("consultation_notification_deliveries").update({ status: "sending", attempt_count: claim.attempt_count, updated_at: new Date().toISOString() }).eq("id", currentDelivery.id).in("status", ["queued", "failed", "sending"]);
  const destination = process.env.CONSULTATION_NOTIFICATION_EMAIL;
  try {
    if (!destination) throw new Error("consultation_destination_not_configured");
    const company = await db.from("company_profiles").select("name").eq("id", lead.company_id).maybeSingle();
    const provider = getConsultationProvider();
    const sent = await provider.send({ to: destination, ...buildConsultationNotification({ companyName: company.data?.name ?? "Компания", name: lead.name, email: lead.email, contactType: lead.contact_type, contactValue: lead.contact_value, comment: lead.comment }) });
    await db.from("consultation_notification_deliveries").update({ status: "sent", provider_message_id: sent.providerMessageId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", currentDelivery.id);
    await db.from("jobs").update({ status: "completed", completed_at: new Date().toISOString(), lease_token: null, lease_expires_at: null, last_error_code: null, last_error_message: null }).eq("id", claim.job_id).eq("lease_token", claim.lease_token);
    return { status: "sent" };
  } catch (error) {
    const code = error instanceof Error ? error.message : "consultation_notification_failed";
    const permanent = /(?:_400|_401|_403)$/.test(code);
    const next = new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.max(0, claim.attempt_count - 1))).toISOString();
    await db.from("consultation_notification_deliveries").update({ status: "failed", last_error_code: code.slice(0, 120), last_error_message: "Notification provider request failed", updated_at: new Date().toISOString() }).eq("id", currentDelivery.id);
    const terminal = permanent || claim.attempt_count >= Number(process.env.CONSULTATION_MAX_ATTEMPTS || 5);
    await db.from("jobs").update({ status: "failed", available_at: terminal ? new Date("2099-01-01").toISOString() : next, attempts: terminal ? Number(process.env.CONSULTATION_MAX_ATTEMPTS || 5) : claim.attempt_count, last_error_code: code.slice(0, 120), last_error_message: "Notification provider request failed", lease_token: null, lease_expires_at: null }).eq("id", claim.job_id).eq("lease_token", claim.lease_token);
    return { status: "failed" };
  }
}

export async function runPendingConsultationNotifications(limit = 10) {
  const db = createAdminClient();
  console.info("[consultation-worker]", { checkpoint: "before_claim", limit });
  const { data, error } = await (db as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: ClaimedJob[] | null; error: SafeRpcError | null }> }).rpc("claim_consultation_notification_jobs", { p_limit: limit, p_max_attempts: Number(process.env.CONSULTATION_MAX_ATTEMPTS || 5), p_lease_seconds: Number(process.env.WORKER_LEASE_SECONDS || 300) });
  if (error) {
    console.error("[consultation-worker]", { checkpoint: "claim_error", code: error.code, message: error.message, details: error.details, hint: error.hint });
    throw claimError(error);
  }
  console.info("[consultation-worker]", { checkpoint: "claim_success", claimed: data?.length ?? 0 });
  const results = [];
  for (const claim of data ?? []) results.push(await processClaimedJob(claim));
  return { claimed: data?.length ?? 0, results };
}

export async function runConsultationNotification(leadRequestId: string) {
  const db = createAdminClient();
  const { data: delivery } = await db.from("consultation_notification_deliveries").select("job_id").eq("lead_request_id", leadRequestId).maybeSingle();
  if (!delivery) return { status: "missing" };
  const result = await runPendingConsultationNotifications(1);
  return result.results[0] ?? { status: "not_claimed" };
}
