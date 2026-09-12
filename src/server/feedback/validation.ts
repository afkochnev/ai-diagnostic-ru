import { z } from "zod";

export const feedbackSchema = z.object({
  diagnostic_id: z.uuid(),
  rating: z.number().int().min(1).max(5),
  useful: z.string().trim().max(3000).nullable().optional(),
  improve: z.string().trim().max(3000).nullable().optional(),
});

export function normalizeFeedbackInput(input: z.infer<typeof feedbackSchema>) {
  return { ...input, useful: input.useful?.trim() || null, improve: input.improve?.trim() || null };
}
