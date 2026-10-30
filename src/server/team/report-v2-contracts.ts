import { z } from "zod";

export const TEAM_REPORT_V2 = "TEAM-RU-2";
export const TEAM_SYNTHESIS_V2 = "TEAM-SYNTHESIS-RU-2";
const text = z.string().min(1).max(12000);
const points = z.array(text).max(20);
export const teamSynthesisV2Schema = z.strictObject({
  themes: z.array(z.strictObject({ title: text, summary: text, question_position: z.number().int().positive(), response_count: z.number().int().min(3) })).max(20),
  strengths: points, problem_patterns: points, growth_constraints: points, risks: points,
  opportunities: points, alignment_signals: points, divergence_signals: points,
  contradictions: points, management_implications: points, discussion_topics: points,
});
export type TeamSynthesisV2 = z.infer<typeof teamSynthesisV2Schema>;
export const teamReportV2Schema = z.strictObject({
  participant_count: z.number().int().min(3),
  summary: text, main_diagnosis: text, manageability_index_text: text,
  strengths: z.array(text).max(5), key_problem_zones: z.array(text).max(5),
  growth_constraint: text, implementation_risks: z.array(text).max(6),
  first_actions: z.array(text).min(1).max(6),
  plan_30_days: z.array(text).min(1).max(7), plan_60_days: z.array(text).min(1).max(7), plan_90_days: z.array(text).min(1).max(7),
  next_step: text,
  team_analysis: z.strictObject({
    alignment: z.array(text).max(12), divergence: z.array(text).max(12),
    qualitative_signals: z.array(text).max(12), discussion_questions: z.array(text).min(1).max(8),
  }),
});
export type TeamReportV2 = z.infer<typeof teamReportV2Schema>;

const count = z.number().int().min(3);
const metrics = { participant_count: count, mean: z.number().finite(), stddev_pop: z.number().min(0), min: z.number(), max: z.number() };
export const teamBlockV2Schema = z.strictObject({ title: text, position: z.number().int().positive(), ...metrics });
export const teamQuestionV2Schema = z.strictObject({
  question: text, block_title: text, block_position: z.number().int().positive(), question_position: z.number().int().positive(),
  reverse_score: z.boolean(), normalized_direction: z.literal("higher_is_stronger"), ...metrics,
  distribution: z.array(z.number().int().nonnegative()).length(5),
});
const contextValue = z.union([z.string(), z.number(), z.null()]);
const companyContext = z.strictObject(Object.fromEntries([
  "company_name", "industry", "country", "products", "customers", "sales_channels", "employees_count",
  "annual_revenue", "company_age_years", "management_levels", "key_problems", "main_goals",
].map(key => [key, contextValue.optional()])));
export const teamReportInputV2Schema = z.strictObject({
  participant_count: count, company_context: companyContext,
  methodology: z.strictObject({ version_number: z.number().int().positive(), algorithm: text, engine_key: text, engine_version: text, schema_version: text }),
  overall: z.strictObject({ ...metrics, maturity: z.string().nullable() }),
  blocks: z.array(teamBlockV2Schema).length(8), questions: z.array(teamQuestionV2Schema).length(80),
});
export type TeamReportInputV2 = z.infer<typeof teamReportInputV2Schema>;
export const qualitativeInputV2Schema = z.strictObject({
  company_context: companyContext,
  block_aggregates: z.array(teamBlockV2Schema).length(8),
  groups: z.array(z.strictObject({
    question: text, question_position: z.number().int().positive(), block_title: text, response_count: count,
    texts: z.array(text).min(3), relevant_block: teamBlockV2Schema.nullable(),
  })).max(4),
});
export type QualitativeInputV2 = z.infer<typeof qualitativeInputV2Schema>;

/** Strict whitelists reject hidden identities/vectors rather than silently stripping them. */
export function mainTeamReportInputV2(aggregates: unknown, summary: unknown) {
  const input = teamReportInputV2Schema.parse(aggregates);
  const synthesis = teamSynthesisV2Schema.parse(summary);
  const positions = new Set(input.blocks.map(b => b.position));
  if (positions.size !== 8 || input.overall.participant_count !== input.participant_count ||
    input.blocks.some(b => b.participant_count !== input.participant_count) ||
    synthesis.themes.some(t => t.response_count > input.participant_count)) throw new Error("team_numeric_integrity");
  const questionKeys = new Set<string>();
  for (const q of input.questions) {
    const n = q.distribution.reduce((a, b) => a + b, 0);
    const mean = q.distribution.reduce((a, b, i) => a + b * i, 0) / n;
    const sd = Math.sqrt(q.distribution.reduce((a, b, i) => a + b * (i - mean) ** 2, 0) / n);
    const key = `${q.block_position}/${q.question_position}`;
    const block = input.blocks.find(b => b.position === q.block_position);
    if (questionKeys.has(key) || !block || q.block_title !== block.title || n !== input.participant_count ||
      q.participant_count !== n || Math.abs(q.mean - mean) > 1e-8 || Math.abs(q.stddev_pop - sd) > 1e-8 ||
      q.min !== q.distribution.findIndex(v => v > 0) || q.max !== q.distribution.findLastIndex(v => v > 0)) throw new Error("team_numeric_integrity");
    questionKeys.add(key);
  }
  return { ...input, qualitative_summary: synthesis };
}

export function parseQualitativeInputV2(value: unknown) {
  const input = qualitativeInputV2Schema.parse(value);
  if (input.groups.some(g => g.response_count !== g.texts.length)) throw new Error("team_numeric_integrity");
  return input;
}
