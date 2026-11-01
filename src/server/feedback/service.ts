import "server-only";
import { createAuthClient } from "@/server/supabase/server";
import { feedbackSchema, teamFeedbackSchema, normalizeFeedbackInput } from "./validation";
import { AccountAccessError, requireDiagnosticRead } from "@/server/account/authorization";

type FeedbackResult = { ok: boolean; duplicate: boolean; feedback_id: string };

export async function getFeedbackStatus(diagnosticId: string) {
  const client = await createAuthClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user?.email_confirmed_at) return false;
  try { await requireDiagnosticRead(diagnosticId, user.id); }
  catch (error) {
    if (error instanceof AccountAccessError) return false;
    throw error;
  }
  const { data, error } = await client.from("feedback").select("id").eq("diagnostic_id", diagnosticId).eq("user_id", user.id).maybeSingle();
  return !error && Boolean(data);
}

export async function createFeedback(input: unknown): Promise<FeedbackResult> {
  const team = typeof input === "object" && input !== null && ("team_diagnostic_id" in input || "team_report_id" in input);
  if (team && "diagnostic_id" in input) throw new Error("invalid_feedback_input");
  const parsed = (team ? teamFeedbackSchema : feedbackSchema).safeParse(input);
  if (!parsed.success) throw new Error("invalid_feedback_input");
  const client = await createAuthClient();
  const value = normalizeFeedbackInput(parsed.data);
  const rpc = client as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
  const target = "team_diagnostic_id" in value ? {p_team_diagnostic_id: value.team_diagnostic_id, p_team_report_id: value.team_report_id} : {p_diagnostic_id: value.diagnostic_id};
  const { data, error } = await rpc.rpc(team ? "create_team_feedback" : "create_feedback", {...target, p_rating: value.rating, p_useful: value.useful, p_improve: value.improve});
  if (error) {
    const known = ["unauthorized", "email_not_verified", "invalid_rating", "diagnostic_not_owned_or_completed", "report_not_owned_or_completed"];
    throw new Error(known.includes(error.message) ? error.message : "feedback_create_failed");
  }
  return data as FeedbackResult;
}

/** Reads only the signed-in requester's feedback metadata under existing RLS. */
export async function getTeamFeedbackStatus(teamId: string) {
  const client = await createAuthClient();
  const {data: {user}, error: authError} = await client.auth.getUser();
  if (authError || !user?.email_confirmed_at) return false;
  const {data, error} = await client.from("feedback").select("id").eq("team_diagnostic_id", teamId).eq("user_id", user.id).maybeSingle();
  return !error && Boolean(data);
}
