import { preservesReportFacts } from "../report-privacy";
import { inspectTeamOutputPrivacy,type PrivacyCorpus,type StringLeaf } from "../synthesis-privacy";
import type { RepairField,RepairResponse } from "../synthesis-repair";

export class QualityRepairError extends Error {
  constructor(readonly reason:"protected_fact_overlap"|"no_editable_span"|"fragment_limit"|"facts_changed"|"repair_path_invalid",readonly fieldPath:string){
    super(reason==="facts_changed"?"team_numeric_integrity":"team_privacy_rejected");
  }
  safeDetails(){return {reason:this.reason,fieldPath:this.fieldPath};}
}
/** Generated fragments only. Corpus and protected statements stay local, in memory.
 * Copy the same protected statements used by the unchanged legacy fact guard. */
export function guardedRepair(leaves:StringLeaf[],maturity:string|null,corpus:PrivacyCorpus){
  const fields:RepairField[]=[],plans:{leaf:StringLeaf;parts:{text:string;repairPath?:string}[]}[]=[];
  for(const leaf of leaves){
    const protectedText=(s:string)=>/\d/u.test(s)||Boolean(maturity&&s.toLowerCase().includes(maturity.toLowerCase()));
    const parts:{text:string;repairPath?:string}[]=[];let at=0;
    for(const match of leaf.value.matchAll(/(?<=[.!?;])\s+|\n+/gu)){
      parts.push({text:leaf.value.slice(at,match.index)},{text:match[0]});at=match.index+match[0].length;
    }
    parts.push({text:leaf.value.slice(at)});
    if(!parts.some(p=>protectedText(p.text))){fields.push({path:leaf.path,value:leaf.value});plans.push({leaf,parts:[{text:leaf.value,repairPath:leaf.path}]});continue;}
    for(let i=0;i<parts.length;i++){
      const part=parts[i];if(!part.text.trim())continue;
      if(protectedText(part.text)){
        const check=inspectTeamOutputPrivacy({text:part.text},corpus);
        if(check.policyViolation||check.overlaps.length)throw new QualityRepairError("protected_fact_overlap",leaf.path);
      }else{part.repairPath=`${leaf.path}__span_${i}`;fields.push({path:part.repairPath,value:part.text});}
    }
    if(!parts.some(p=>p.repairPath))throw new QualityRepairError("no_editable_span",leaf.path);
    plans.push({leaf,parts});
  }
  if(!fields.length||fields.length>24||fields.reduce((n,f)=>n+f.value.length,0)>48000)throw new QualityRepairError("fragment_limit",leaves[0]?.path??"");
  return {fields,rebuild(response:RepairResponse){
    const allowed=new Set(fields.map(f=>f.path));
    if(response.repairs.length!==fields.length||new Set(response.repairs.map(r=>r.path)).size!==fields.length||response.repairs.some(r=>!allowed.has(r.path)))throw new QualityRepairError("repair_path_invalid",leaves[0]?.path??"");
    const replacements=new Map(response.repairs.map(r=>[r.path,r.replacement]));
    return plans.map(({leaf,parts})=>{
      const replacement=parts.map(p=>p.repairPath?replacements.get(p.repairPath)!:p.text).join("");
      if(!replacement||!preservesReportFacts(leaf.value,replacement,maturity))throw new QualityRepairError("facts_changed",leaf.path);
      return {leaf,replacement};
    });
  }};
}
