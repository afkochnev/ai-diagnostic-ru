import "server-only";
import { createAuthClient } from "@/server/supabase/server";
import { consultationSchema, normalizeConsultationInput } from "./validation";

export async function createConsultationLead(input: unknown) {
  const parsed = consultationSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_consultation_input");
  const client = await createAuthClient();
  const normalized = normalizeConsultationInput(parsed.data);
  const rpcClient = client as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
  const { data, error } = await rpcClient.rpc("create_lead_request", {
    p_diagnostic_id: normalized.diagnostic_id,
    p_report_id: normalized.report_id,
    p_name: normalized.name,
    p_contact_type: normalized.contact_type ?? null,
    p_contact_value: normalized.contact_value,
    p_comment: normalized.comment,
    p_idempotency_key: normalized.idempotency_key,
  });
  if (error) {
    const known = ["unauthorized", "email_not_verified", "diagnostic_not_owned_or_completed", "report_not_owned_or_completed", "invalid_name", "invalid_contact_type", "contact_pair_required", "invalid_phone", "invalid_telegram", "invalid_comment"];
    throw new Error(known.includes(error.message) ? error.message : "consultation_create_failed");
  }
  return data as { ok: boolean; duplicate: boolean; lead_id: string; status: string };
}
