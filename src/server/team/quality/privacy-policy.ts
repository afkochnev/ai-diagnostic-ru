import { inspectTeamOutputPrivacy,normalizePrivacyText,stringLeaves,type PrivacyCorpus,type OverlapDiagnostic } from "../synthesis-privacy";

export type ResearchPrivacyPolicy="strict"|"unattributed";
/** Explicit owner-directed private research policy. Anonymous wording may match
 * a source answer; direct respondent identifiers remain forbidden. No DB changes. */
export function inspectResearchPrivacy(value:unknown,corpus:PrivacyCorpus,policy:ResearchPrivacyPolicy="strict") {
  if(policy==="strict")return inspectTeamOutputPrivacy(value,corpus);
  const identifiers=corpus.identifiers.flatMap(id=>{
    const text=normalizePrivacyText(id);
    return /^[\p{L}\s’'\-]+$/u.test(text)?[text,...text.split(/\s+/u).filter(p=>p.length>=3)]:[text];
  }).filter(Boolean);
  const escaped=(id:string)=>id.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const named=identifiers.map(id=>new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped(id)}(?=$|[^\\p{L}\\p{N}])`,"u"));
  const direct=/[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}.\-]+\.[\p{L}]{2,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\+?[0-9][0-9 ()\-]{7,}[0-9]|https?:\/\/|www\./iu;
  const violations:OverlapDiagnostic[]=[];
  for(const leaf of stringLeaves(value)){
    const text=normalizePrivacyText(leaf.value);
    if(direct.test(text)||named.some(re=>re.test(text)))violations.push({field_path:leaf.path,match_length:0,source_question_index:0});
  }
  return {overlaps:[] as OverlapDiagnostic[],policyViolation:violations.length>0,violations};
}
