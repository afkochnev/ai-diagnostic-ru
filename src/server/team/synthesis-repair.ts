import { z } from "zod";
import { teamSynthesisV2Schema, type TeamSynthesisV2, type QualitativeInputV2 } from "./report-v2-contracts";
import { inspectSynthesisPrivacy, stringLeaves, type PrivacyCorpus, type OverlapDiagnostic } from "./synthesis-privacy";

export type RepairField = { path: string; value: string };
export type RepairResponse = { repairs: { path: string; replacement: string }[] };
export type SafePrivacyEvent = { event: "team_synthesis_overlap_detected"; violations: OverlapDiagnostic[] };
export function repairResponseSchema(paths: string[]) {
  if (!paths.length || paths.length>24 || new Set(paths).size!==paths.length) throw new Error("team_privacy_rejected");
  return z.strictObject({repairs:z.array(z.strictObject({path:z.enum(paths as [string,...string[]]),replacement:z.string().trim().min(1).max(12000)})).length(paths.length)});
}
function validateGrounding(summary: TeamSynthesisV2, input: QualitativeInputV2) {
  if(summary.themes.some(t=>{
    const group=input.groups.find(g=>g.question_position===t.question_position);
    return !group || t.response_count>group.response_count;
  })) throw new Error("team_numeric_integrity");
}
function substantiveReplacement(old: string, replacement: string) {
  const normalized=replacement.trim().toLowerCase().replace(/[.!?]+$/u,"");
  if(normalized.length<12 || /^(?:есть некоторые проблемы|требуется обратить внимание|есть разные мнения)$/u.test(normalized)) return false;
  // Do not manufacture numeric facts while paraphrasing. Themes' counters are never editable.
  const numbers=(s:string)=>[...s.matchAll(/\d+(?:[.,]\d+)?/g)].map(m=>m[0]).sort();
  return JSON.stringify(numbers(old))===JSON.stringify(numbers(replacement));
}

/** At most one targeted call. Raw corpus is confined to inspection and never passed to repair. */
export async function validateAndRepairSynthesis(
  value: unknown, input: QualitativeInputV2, corpus: PrivacyCorpus,
  repair: (fields: RepairField[])=>Promise<unknown>,
  emit: (event: SafePrivacyEvent)=>void = ()=>{},
): Promise<TeamSynthesisV2> {
  const original=teamSynthesisV2Schema.parse(value);
  validateGrounding(original,input);
  const check=inspectSynthesisPrivacy(original,corpus);
  if(check.policyViolation) throw new Error("team_privacy_rejected");
  if(!check.overlaps.length) return original;
  emit({event:"team_synthesis_overlap_detected",violations:check.overlaps});
  const paths=new Set(check.overlaps.map(d=>d.field_path));
  const leaves=stringLeaves(original).filter(leaf=>paths.has(leaf.path));
  const fields=leaves.map(({path,value})=>({path,value}));
  const schema=repairResponseSchema(fields.map(f=>f.path));
  if(fields.reduce((n,f)=>n+f.value.length,0)>48000) throw new Error("team_privacy_rejected");
  let result: RepairResponse;
  try { result=schema.parse(await repair(fields)); } catch { throw new Error("team_privacy_rejected"); }
  if(new Set(result.repairs.map(r=>r.path)).size!==paths.size) throw new Error("team_privacy_rejected");
  const clone=structuredClone(original);
  for(const leaf of leaves) {
    const replacement=result.repairs.find(r=>r.path===leaf.path)?.replacement;
    if(!replacement || !substantiveReplacement(leaf.value,replacement)) throw new Error("team_privacy_rejected");
    let target: unknown=clone;
    for(const key of leaf.tokens.slice(0,-1)) target=(target as Record<string|number,unknown>)[key];
    (target as Record<string|number,unknown>)[leaf.tokens.at(-1)!]=replacement;
  }
  const rebuilt=teamSynthesisV2Schema.parse(clone);
  validateGrounding(rebuilt,input);
  const final=inspectSynthesisPrivacy(rebuilt,corpus);
  if(final.policyViolation || final.overlaps.length) throw new Error("team_privacy_rejected");
  return rebuilt;
}
