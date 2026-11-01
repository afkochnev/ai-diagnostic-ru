import { z } from "zod";

export const feedbackSchema = z.object({
  diagnostic_id: z.uuid(),
  rating: z.number().int().min(1).max(5),
  useful: z.string().trim().max(3000).nullable().optional(),
  improve: z.string().trim().max(3000).nullable().optional(),
});
export const teamFeedbackSchema = feedbackSchema.omit({diagnostic_id: true}).extend({team_diagnostic_id: z.uuid(), team_report_id: z.uuid()});

export function normalizeFeedbackInput<T extends z.infer<typeof feedbackSchema> | z.infer<typeof teamFeedbackSchema>>(input: T) {
  return { ...input, useful: input.useful?.trim() || null, improve: input.improve?.trim() || null };
}
