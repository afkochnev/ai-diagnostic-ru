import "server-only";
import { createAuthClient } from "@/server/supabase/server";
import { feedbackSchema, normalizeFeedbackInput } from "./validation";
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
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_feedback_input");
  const client = await createAuthClient();
  const value = normalizeFeedbackInput(parsed.data);
  const rpc = client as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
  const { data, error } = await rpc.rpc("create_feedback", { p_diagnostic_id: value.diagnostic_id, p_rating: value.rating, p_useful: value.useful, p_improve: value.improve });
  if (error) {
    const known = ["unauthorized", "email_not_verified", "invalid_rating", "diagnostic_not_owned_or_completed"];
    throw new Error(known.includes(error.message) ? error.message : "feedback_create_failed");
  }
  return data as FeedbackResult;
}
