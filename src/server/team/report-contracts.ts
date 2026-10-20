import { z } from "zod";
const paragraph = z.string().min(1).max(5000);
const points = z.array(paragraph).max(20);
export const synthesisSchema = z.strictObject({
  themes: z.array(z.strictObject({ title: paragraph, summary: paragraph, response_count: z.number().int().min(3) })).max(20),
  strengths: points, risks: points, alignment_signals: points, divergence_signals: points,
});
export type TeamSynthesis = z.infer<typeof synthesisSchema>;
export const teamReportSchema = z.strictObject({
  participant_count: z.number().int().min(3), executive_summary: paragraph, maturity: paragraph,
  strongest_blocks: points, weakest_blocks: points, agreement: points, disagreement: points,
  qualitative_themes: points, risks: points, priorities: points, next_steps: points,
});
export type TeamReportContent = z.infer<typeof teamReportSchema>;
export const metricSchema = z.strictObject({ title: z.string(), position: z.number(), mean: z.number(), stddev: z.number(), min: z.number(), max: z.number() });
export const teamReportInputSchema = z.strictObject({
  participant_count: z.number().int().min(3), company_context: z.record(z.string(), z.union([z.string(),z.number(),z.null()])),
  overall: z.strictObject({ mean: z.number(), stddev: z.number(), min: z.number(), max: z.number(), maturity: z.string().nullable() }),
  blocks: z.array(metricSchema), questions: z.array(z.strictObject({ question: z.string(), mean: z.number(), stddev: z.number() })),
});
export type TeamReportInput = z.infer<typeof teamReportInputSchema>;
export const qualitativeGroupsSchema = z.array(z.strictObject({ question: z.string(), texts: z.array(z.string().min(1)).min(3), response_count: z.number().int().min(3) }));
export type QualitativeGroups = z.infer<typeof qualitativeGroupsSchema>;
/** This explicit whitelist is the sole main-report input boundary. */
export function mainTeamReportInput(aggregates: unknown, summary: unknown) {
  return { ...teamReportInputSchema.parse(aggregates), qualitative_summary: synthesisSchema.parse(summary) };
}
