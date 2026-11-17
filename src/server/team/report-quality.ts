import { teamReportInputV2Schema, teamReportV2Schema, type TeamReportV2, type TeamSynthesisV2 } from "./report-v2-contracts";
import { inspectCoreQuality, validateCoreQuality, type CoreQualityIssue } from "./report-v3-contracts";
import { inspectReportPrivacy, preservesReportFacts } from "./report-privacy";
import { stringLeaves, type PrivacyCorpus } from "./synthesis-privacy";
import { repairResponseSchema, type RepairField } from "./synthesis-repair";

export type CoreQualityEvent = {
  event: "team_core_quality_detected" | "team_core_quality_repaired";
  issues: CoreQualityIssue[];
};

/** One bounded edit of generated flagged fields; no raw answer or privacy corpus is sent to repair. */
export async function validateAndRepairCoreQuality(
  value: unknown, aggregates: unknown, corpus: PrivacyCorpus, provider: "mock" | "openai",
  synthesis: TeamSynthesisV2,
  repair: (fields: RepairField[], issues: CoreQualityIssue[]) => Promise<unknown>,
  emit: (event: CoreQualityEvent) => void = () => {},
): Promise<TeamReportV2> {
  const input = teamReportInputV2Schema.parse(aggregates);
  const original = teamReportV2Schema.parse(value);
  if (original.participant_count !== input.participant_count) throw new Error("team_numeric_integrity");
  const initialPrivacy = inspectReportPrivacy(original, corpus);
  if (initialPrivacy.policyViolation || initialPrivacy.overlaps.length) throw new Error("team_privacy_rejected");
  const issues = inspectCoreQuality(original, provider);
  if (!issues.length) return original;
  emit({event: "team_core_quality_detected", issues});
  if (provider === "mock") throw new Error("team_quality_rejected");

  const paths = new Set(issues.map(issue => issue.field_path));
  const leaves = stringLeaves(original).filter(leaf => paths.has(leaf.path));
  if (!leaves.length || leaves.length > 24 || leaves.reduce((n, leaf) => n + leaf.value.length, 0) > 48000) {
    throw new Error("team_quality_rejected");
  }
  const fields = leaves.map(({path, value}) => ({path, value}));
  const schema = repairResponseSchema(fields.map(field => field.path));
  let result;
  try { result = schema.parse(await repair(fields, issues)); }
  catch { throw new Error("team_quality_rejected"); }
  if (new Set(result.repairs.map(item => item.path)).size !== paths.size) throw new Error("team_quality_rejected");
  const clone = structuredClone(original);
  for (const leaf of leaves) {
    const replacement = result.repairs.find(item => item.path === leaf.path)?.replacement;
    if (!replacement || replacement.length < 12) throw new Error("team_quality_rejected");
    if (!preservesReportFacts(leaf.value, replacement, input.overall.maturity)) throw new Error("team_numeric_integrity");
    let target: unknown = clone;
    for (const token of leaf.tokens.slice(0, -1)) target = (target as Record<string | number, unknown>)[token];
    (target as Record<string | number, unknown>)[leaf.tokens.at(-1)!] = replacement;
  }
  const rebuilt = teamReportV2Schema.parse(clone);
  if (rebuilt.participant_count !== original.participant_count) throw new Error("team_numeric_integrity");
  const finalPrivacy = inspectReportPrivacy(rebuilt, corpus);
  if (finalPrivacy.policyViolation || finalPrivacy.overlaps.length) throw new Error("team_privacy_rejected");
  validateCoreQuality(rebuilt, provider, synthesis);
  emit({event: "team_core_quality_repaired", issues});
  return rebuilt;
}
