import "server-only";
import { createAuthClient } from "@/server/supabase/server";
import { consultationSchema, teamConsultationSchema, normalizeConsultationInput } from "./validation";

export async function createConsultationLead(input: unknown) {
  const team = typeof input === "object" && input !== null && ("team_diagnostic_id" in input || "team_report_id" in input);
  if (team && ("diagnostic_id" in input || "report_id" in input)) throw new Error("invalid_consultation_input");
  const parsed = (team ? teamConsultationSchema : consultationSchema).safeParse(input);
  if (!parsed.success) throw new Error("invalid_consultation_input");
  const client = await createAuthClient();
  const normalized = normalizeConsultationInput(parsed.data);
  const rpcClient = client as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
  const target = "team_diagnostic_id" in normalized ? {p_team_diagnostic_id: normalized.team_diagnostic_id, p_team_report_id: normalized.team_report_id}
    : {p_diagnostic_id: normalized.diagnostic_id, p_report_id: normalized.report_id};
  const { data, error } = await rpcClient.rpc(team ? "create_team_lead_request" : "create_lead_request", {
    ...target,
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
