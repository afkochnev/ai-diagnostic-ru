import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/server-runtime/supabase/admin";
import { buildConsultationNotification } from "./content";
import { getConsultationProvider } from "./provider";
import { ConsultationDeliveryError, consultationDestination } from "./config";

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

function maximumAttempts() {
  const value = Number(process.env.CONSULTATION_MAX_ATTEMPTS || 5);
  return Number.isInteger(value) && value >= 1 && value <= 20 ? value : 5;
}

async function processClaimedJob(claim: ClaimedJob) {
  const db = createAdminClient();
  let deliveryId: string | undefined;
  async function complete() {
    const { data, error } = await db.from("jobs").update({ status: "completed", completed_at: new Date().toISOString(), lease_token: null, lease_expires_at: null, last_error_code: null, last_error_message: null }).eq("id", claim.job_id).eq("lease_token", claim.lease_token).select("id").maybeSingle();
    if (error || !data) throw new ConsultationDeliveryError("consultation_job_persist_failed", true);
  }
  try {
    const { data: job, error: jobError } = await db.from("jobs").select("id,status,lease_token").eq("id", claim.job_id).eq("lease_token", claim.lease_token).eq("status", "running").maybeSingle();
    if (jobError) throw new ConsultationDeliveryError("consultation_storage_unavailable", true);
    if (!job) return { status: "lease_lost" };
    const { data: lead, error: leadError } = await db.from("lead_requests").select("id,company_id,name,email,contact_type,contact_value,comment,diagnostic_id").eq("id", claim.lead_request_id).maybeSingle();
    if (leadError) throw new ConsultationDeliveryError("consultation_storage_unavailable", true);
    if (!lead) throw new ConsultationDeliveryError("consultation_lead_missing", false);
    const { data: delivery, error: deliveryError } = await db.from("consultation_notification_deliveries").select("id,status,provider_message_id").eq("lead_request_id", claim.lead_request_id).eq("job_id", claim.job_id).maybeSingle();
    if (deliveryError) throw new ConsultationDeliveryError("consultation_storage_unavailable", true);
    if (!delivery) throw new ConsultationDeliveryError("consultation_delivery_missing", false);
    deliveryId = delivery.id;
    if (delivery.status === "sent") { await complete(); return { status: "sent" }; }
    const destination = consultationDestination();
    const provider = getConsultationProvider();
    const { data: company, error: companyError } = await db.from("company_profiles").select("name").eq("id", lead.company_id).maybeSingle();
    if (companyError) throw new ConsultationDeliveryError("consultation_storage_unavailable", true);
    if (!company) throw new ConsultationDeliveryError("consultation_company_missing", false);
    const sending = await db.from("consultation_notification_deliveries").update({ status: "sending", provider: provider.name, attempt_count: claim.attempt_count, updated_at: new Date().toISOString() }).eq("id", deliveryId).in("status", ["queued", "failed", "sending"]).select("id").maybeSingle();
    if (sending.error || !sending.data) throw new ConsultationDeliveryError("consultation_delivery_persist_failed", true);
    const sent = await provider.send({ to: destination, idempotencyKey: `consultation-notification/${deliveryId}`, ...buildConsultationNotification({ companyName: company.name, name: lead.name, email: lead.email, contactType: lead.contact_type, contactValue: lead.contact_value, comment: lead.comment }) });
    if (!sent.providerMessageId) throw new ConsultationDeliveryError("consultation_provider_receipt_missing", false);
    const persisted = await db.from("consultation_notification_deliveries").update({ status: "sent", provider_message_id: sent.providerMessageId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error_code: null, last_error_message: null }).eq("id", deliveryId).select("id").maybeSingle();
    if (persisted.error || !persisted.data) throw new ConsultationDeliveryError("consultation_delivery_persist_failed", true);
    await complete();
    return { status: "sent" };
  } catch (error) {
    const failure = error instanceof ConsultationDeliveryError ? error : new ConsultationDeliveryError("consultation_notification_failed", true);
    const next = new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.max(0, claim.attempt_count - 1))).toISOString();
    if (deliveryId) {
      const result = await db.from("consultation_notification_deliveries").update({ status: "failed", last_error_code: failure.code, last_error_message: "Notification provider request failed", updated_at: new Date().toISOString() }).eq("id", deliveryId).in("status", ["queued", "sending", "failed"]);
      if (result.error) throw new ConsultationDeliveryError("consultation_failure_persist_failed", true);
    }
    const terminal = !failure.retryable || claim.attempt_count >= maximumAttempts();
    const failed = await db.from("jobs").update({ status: "failed", available_at: terminal ? new Date("2099-01-01").toISOString() : next, attempts: terminal ? maximumAttempts() : claim.attempt_count, last_error_code: failure.code, last_error_message: "Notification provider request failed", lease_token: null, lease_expires_at: null }).eq("id", claim.job_id).eq("lease_token", claim.lease_token);
    if (failed.error) throw new ConsultationDeliveryError("consultation_failure_persist_failed", true);
    return { status: "failed" };
  }
}

export async function runPendingConsultationNotifications(limit = 10) {
  const db = createAdminClient();
  console.info("[consultation-worker]", { checkpoint: "before_claim", limit });
  const { data, error } = await (db as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: ClaimedJob[] | null; error: SafeRpcError | null }> }).rpc("claim_consultation_notification_jobs", { p_limit: limit, p_max_attempts: maximumAttempts(), p_lease_seconds: Number(process.env.WORKER_LEASE_SECONDS || 300) });
  if (error) {
    console.error("[consultation-worker]", { checkpoint: "claim_error", code: error.code, message: error.message, details: error.details, hint: error.hint });
    throw claimError(error);
  }
  console.info("[consultation-worker]", { checkpoint: "claim_success", claimed: data?.length ?? 0 });
  const results = [];
  for (const claim of data ?? []) results.push(await processClaimedJob(claim));
  return { claimed: data?.length ?? 0, results };
}

// Unlike the queue runner, this entry point may only claim this lead's idle job.
// The compare-and-swap makes concurrent invocations safe without a global claim.
export async function runConsultationNotification(leadRequestId: string) {
  const db = createAdminClient();
  const { data: delivery, error: deliveryError } = await db.from("consultation_notification_deliveries").select("job_id,status").eq("lead_request_id", leadRequestId).maybeSingle();
  if (deliveryError) throw new ConsultationDeliveryError("consultation_storage_unavailable", true);
  if (!delivery) return { status: "missing" };
  if (delivery.status === "sent") return { status: "sent" };
  const { data: job, error: jobError } = await db.from("jobs").select("id,status,attempts,available_at,lease_token").eq("id", delivery.job_id).eq("kind", "consultation_notification").maybeSingle();
  if (jobError) throw new ConsultationDeliveryError("consultation_storage_unavailable", true);
  if (!job || !["queued", "failed"].includes(job.status) || job.lease_token || job.attempts >= maximumAttempts() || Date.parse(job.available_at) > Date.now()) return { status: "not_claimed" };
  const leaseToken = randomUUID();
  const leaseSeconds = Math.max(30, Math.min(900, Number(process.env.WORKER_LEASE_SECONDS) || 300));
  const { data: claimed, error: claimError } = await db.from("jobs").update({ status: "running", attempts: job.attempts + 1, lease_token: leaseToken, lease_expires_at: new Date(Date.now() + leaseSeconds * 1000).toISOString(), started_at: new Date().toISOString() }).eq("id", job.id).eq("status", job.status).eq("attempts", job.attempts).is("lease_token", null).select("id").maybeSingle();
  if (claimError) throw new ConsultationDeliveryError("consultation_claim_failed", true);
  if (!claimed) return { status: "not_claimed" };
  return processClaimedJob({ job_id: job.id, lead_request_id: leadRequestId, lease_token: leaseToken, attempt_count: job.attempts + 1 });
}
