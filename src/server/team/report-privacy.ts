import { teamReportV2Schema, teamReportInputV2Schema, type TeamReportInputV2, type TeamReportV2 } from "./report-v2-contracts";
import { inspectTeamOutputPrivacy, stringLeaves, type PrivacyCorpus, type OverlapDiagnostic } from "./synthesis-privacy";
import { repairResponseSchema, type RepairField } from "./synthesis-repair";

export const inspectReportPrivacy = inspectTeamOutputPrivacy;
export type ReportPrivacyEvent = { event: "team_report_privacy_detected" | "team_mock_report_privacy_failure"; violations: OverlapDiagnostic[] };
function grounding(report: TeamReportV2, input: TeamReportInputV2) {
  if(report.participant_count!==input.participant_count) throw new Error("team_numeric_integrity");
}
/** Preserve numeric literals, dates/version tokens and maturity, including repeated occurrences. */
export function preservesReportFacts(before: string, after: string, maturity: string | null) {
  const tokens=(s:string,re:RegExp)=>[...s.matchAll(re)].map(m=>m[0]).sort();
  for(const re of [/[-+−]?\d+(?:[.,]\d+)?/gu,/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})\b/gu,/\b[A-Z][A-Z0-9_-]*\d[A-Z0-9_.-]*\b/gu]) {
    if(JSON.stringify(tokens(before,re))!==JSON.stringify(tokens(after,re))) return false;
  }
  if(maturity) {
    const occurrences=(s:string)=>s.toLowerCase().split(maturity.toLowerCase()).length;
    if(occurrences(before)!==occurrences(after)) return false;
  }
  // A multiset alone would allow swapping values between metrics. Keep each
  // number-bearing statement intact; unprovable paraphrases fail closed.
  const normalized=(s:string)=>s.toLowerCase().replace(/\s+/gu," ").trim();
  const protectedStatements=before.split(/(?<=[.!?;])\s+|\n+/u)
    .filter(s=>/\d/u.test(s) || Boolean(maturity && s.toLowerCase().includes(maturity.toLowerCase())))
    .map(s=>normalized(s).replace(/[.!?;]+$/u,""));
  if(protectedStatements.some(s=>!normalized(after).includes(s))) return false;
  return true;
}
/** At most one targeted call. The corpus is confined to inspection, never sent to repair. */
export async function validateAndRepairReport(
  value: unknown, aggregates: unknown, corpus: PrivacyCorpus, provider: "mock" | "openai",
  repair: (fields: RepairField[])=>Promise<unknown>, emit: (event: ReportPrivacyEvent)=>void=()=>{},
): Promise<TeamReportV2> {
  const input=teamReportInputV2Schema.parse(aggregates),original=teamReportV2Schema.parse(value);
  grounding(original,input);
  const check=inspectReportPrivacy(original,corpus);
  if(!check.policyViolation && !check.overlaps.length) return original;
  emit({event:provider==="mock"?"team_mock_report_privacy_failure":"team_report_privacy_detected",violations:check.violations});
  if(provider==="mock") throw new Error("team_privacy_rejected");
  const paths=new Set(check.violations.map(v=>v.field_path));
  const leaves=stringLeaves(original).filter(leaf=>paths.has(leaf.path));
  const fields=leaves.map(({path,value})=>({path,value}));
  if(!fields.length || fields.reduce((n,f)=>n+f.value.length,0)>48000) throw new Error("team_privacy_rejected");
  const schema=repairResponseSchema(fields.map(f=>f.path));
  let result;
  try {result=schema.parse(await repair(fields));} catch {throw new Error("team_privacy_rejected");}
  if(new Set(result.repairs.map(r=>r.path)).size!==paths.size) throw new Error("team_privacy_rejected");
  const clone=structuredClone(original);
  for(const leaf of leaves) {
    const replacement=result.repairs.find(r=>r.path===leaf.path)?.replacement;
    if(!replacement || replacement.length<12 || !preservesReportFacts(leaf.value,replacement,input.overall.maturity)) throw new Error("team_numeric_integrity");
    let target: unknown=clone;
    for(const key of leaf.tokens.slice(0,-1)) target=(target as Record<string|number,unknown>)[key];
    (target as Record<string|number,unknown>)[leaf.tokens.at(-1)!]=replacement;
  }
  const rebuilt=teamReportV2Schema.parse(clone);grounding(rebuilt,input);
  const final=inspectReportPrivacy(rebuilt,corpus);
  if(final.policyViolation || final.overlaps.length) throw new Error("team_privacy_rejected");
  return rebuilt;
}
