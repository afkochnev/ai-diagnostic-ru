import "server-only";
import { createAuthClient } from "@/server/supabase/server";
import { feedbackSchema, normalizeFeedbackInput } from "./validation";

type FeedbackResult = { ok: boolean; duplicate: boolean; feedback_id: string };

export async function getFeedbackStatus(diagnosticId: string) {
  const client = await createAuthClient();
  const feedbackClient = client as unknown as { from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: { id: string } | null; error: unknown }> } } } };
  const { data, error } = await feedbackClient.from("feedback").select("id").eq("diagnostic_id", diagnosticId).maybeSingle();
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
