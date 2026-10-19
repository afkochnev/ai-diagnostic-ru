import { createHash } from "node:crypto";
import { z } from "zod";
import { teamReportV3Schema,teamSynthesisV3Schema,mainTeamReportInputV3,validateCoreQuality,qualitativeCoverage } from "../report-v3-contracts";
import { inspectTeamOutputPrivacy,stringLeaves,type PrivacyCorpus } from "../synthesis-privacy";
import { repairResponseSchema } from "../synthesis-repair";
import { preservesReportFacts } from "../report-privacy";
import { buildDossier,repetitionSignals,type Dossier } from "./dossier";
import { cardsSchema,diagnosisSchema,programSchema,draftSchema,groundedDraftSchema,groundedCombinedSchema,flattenGroundedDraft,dynamicsSchema,reviewSchema,qualityReportSchema,uniqueIds,requireRefs,QualityReferenceError,type Cards,type Diagnoses,type Program,type QualityReport } from "./contracts";

export type Variant="A"|"B"|"C";
export type Stage="baseline_synthesis"|"baseline_report"|"extract"|"diagnose"|"program"|"core"|"dynamics"|"combined"|"review"|"privacy_repair";
export const stageTokens:Record<Stage,number>={baseline_synthesis:6000,baseline_report:14000,extract:4000,diagnose:4000,program:6000,core:9000,dynamics:4000,combined:11000,review:4000,privacy_repair:6000};
export const normalCalls={A:2,B:2,C:6};
export type StageRequest={stage:Stage;input:unknown;schema:z.ZodType;maxOutputTokens:number;deadline:number};
export type SafeEvent={stage:Stage;status:"requested"|"privacy_validated"|"contract_validated";inputSHA256?:string;outputSHA256?:string;elapsedMs?:number};
export type StagePort=(request:StageRequest)=>Promise<unknown>;
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function validateCards(cards:Cards,d:Dossier) {
  uniqueIds(cards.cards);
  if(d.extraction.groups.length&&!cards.cards.length)throw new Error("team_qualitative_insufficient");
  if(cards.cards.some(c=>!d.extraction.groups.some(g=>g.question_position===c.question_position)))throw new Error("quality_reference_invalid");
  // Missing coverage must be explained, not silently lost or replaced with a service phrase.
  const positions=new Set(d.extraction.groups.map(g=>g.question_position));
  if(new Set(cards.omitted_groups.map(g=>g.question_position)).size!==cards.omitted_groups.length||cards.omitted_groups.some(g=>!positions.has(g.question_position)||cards.cards.some(c=>c.question_position===g.question_position)))throw new Error("quality_reference_invalid");
  for(const group of d.extraction.groups)if(!cards.cards.some(c=>c.question_position===group.question_position)&&!cards.omitted_groups.some(g=>g.question_position===group.question_position))throw new Error("team_qualitative_insufficient");
}
export function validateDiagnoses(value:Diagnoses,known:Set<string>) {
  uniqueIds(value.diagnoses);
  for(const d of value.diagnoses){requireRefs(d.evidence_refs,known);if(d.goal_ref)requireRefs([d.goal_ref],known);}
  if(!value.diagnoses.length&&!value.limitations.length)throw new Error("quality_reference_invalid");
}
export function validateProgram(value:Program,diagnoses:Diagnoses) {
  uniqueIds(value.initiatives);const known=new Set(diagnoses.diagnoses.map(d=>d.id)),seen=new Set<string>();
  const order={immediate:0,"30":1,"60":2,"90":3};
  const all=value.initiatives.flatMap(i=>i.actions),phase=new Map(all.map(a=>[a.id,order[a.phase]] as const));
  for(const i of value.initiatives){requireRefs(i.diagnosis_refs,known);for(const a of i.actions){
    if(seen.has(a.id))throw new Error("quality_reference_invalid");seen.add(a.id);
    if(a.depends_on.some(id=>id===a.id||!phase.has(id)||phase.get(id)!>order[a.phase]))throw new Error("quality_dependency_invalid");
  }}
  const visiting=new Set<string>(),done=new Set<string>();
  const visit=(id:string)=>{if(visiting.has(id))throw new Error("quality_dependency_invalid");if(done.has(id))return;visiting.add(id);for(const dep of all.find(a=>a.id===id)!.depends_on)visit(dep);visiting.delete(id);done.add(id);};
  for(const a of all)visit(a.id);
  if(diagnoses.diagnoses.length&&!value.initiatives.length&&!value.limitations.length)throw new Error("quality_reference_invalid");
}
export function validateDraft(value:z.infer<typeof draftSchema>,known:Set<string>,d:Dossier) {
  const leaves=stringLeaves(value.content),paths=new Set(leaves.map(l=>l.path));
  if(new Set(value.support.map(s=>s.path)).size!==value.support.length)throw new QualityReferenceError("duplicate_support_path");
  if(value.support.some(s=>!paths.has(s.path)))throw new QualityReferenceError("unknown_support_path");
  for(const leaf of leaves){const support=value.support.find(s=>s.path===leaf.path);if(!support)throw new QualityReferenceError("missing_support_path");requireRefs(support.refs,known);}
  const text=leaves.map(l=>l.value).join("\n");
  if(/stddev|variance|distribution|разброс|поляризац|расхождени|дисперси|среднее скрывает/iu.test(text))throw new Error("team_quality_rejected");
  if(/качественные ответы дополняют средний профиль|тестовый отчёт|архитектура исполнения/iu.test(text))throw new Error("team_quality_rejected");
  // This catches invented literals, not semantic attribution. The critic must separately
  // check that each value/claim is supported by the cited metric and interpretation.
  const numbers=(s:string)=>[...s.matchAll(/\d+(?:[.,]\d+)?/gu)].map(m=>Number(m[0].replace(",",".")));
  const allowed=new Set([0,4,5,30,60,90,100,...d.primary.facts.flatMap(f=>numbers(String(f.value))).flatMap(n=>[n,Math.round(n*10)/10])]);
  if(numbers(text).some(n=>!allowed.has(n)))throw new Error("team_numeric_integrity");
}

/** Local prototype only: no DB queue or publication, no credentials, no implicit network.
 * Every generated stage requires an injected DB validator after the unchanged local gate.
 * Semantic support is NOT certified by reference checks alone; owner review stays required. */
export async function runQualityVariant(options:{variant:Variant;aggregates:unknown;qualitative:unknown;corpus:PrivacyCorpus;
  call:StagePort;databaseValidate:(value:unknown)=>Promise<void>;deadline:number;maxCalls:number;emit?:(e:SafeEvent)=>void}) {
  const {variant,call,corpus,databaseValidate,deadline,maxCalls}=options,d=buildDossier(options.aggregates,options.qualitative);
  const known=new Set(d.known);let calls=0,repairs=0;
  const finalGate=async(report:QualityReport)=>{
    const p=inspectTeamOutputPrivacy(report,corpus);if(p.policyViolation||p.overlaps.length)throw new Error("team_privacy_rejected");
    await databaseValidate(report);
  };
  const perform=async<T>(stage:Stage,input:unknown,schema:z.ZodType<T>):Promise<T>=>{
    if(Date.now()>=deadline||calls>=maxCalls)throw new Error("quality_budget_exhausted");
    // Only the extraction/synthesis boundary may see shuffled, masked raw groups.
    if(stage!=="extract"&&stage!=="baseline_synthesis"&&stage!=="privacy_repair"){
      const p=inspectTeamOutputPrivacy(input,corpus);if(p.policyViolation||p.overlaps.length)throw new Error("team_privacy_rejected");
    }
    calls++;options.emit?.({stage,status:"requested",inputSHA256:hash(input)});
    let result:T;
    try{result=schema.parse(await call({stage,input,schema,maxOutputTokens:stageTokens[stage],deadline}));}catch(error){throw new Error(error instanceof Error&&error.message==="quality_budget_exhausted"?error.message:"quality_stage_failed");}
    if(Date.now()>=deadline)throw new Error("quality_budget_exhausted");
    return result;
  };
  const invoke=async<T>(stage:Stage,input:unknown,schema:z.ZodType<T>):Promise<T>=>{
    const started=Date.now();let result:T=await perform(stage,input,schema);
    const p=inspectTeamOutputPrivacy(result,corpus);
    if(p.policyViolation||p.overlaps.length){
      if(repairs>=2)throw new Error("team_privacy_rejected");
      const paths=new Set(p.violations.map(v=>v.field_path)),leaves=stringLeaves(result).filter(l=>paths.has(l.path));
      if(!leaves.length||leaves.reduce((n,l)=>n+l.value.length,0)>48000)throw new Error("team_privacy_rejected");
      repairs++;
      // Only generated flagged strings cross the repair boundary. Never raw answers,
      // corpus, unflagged fields, participant metadata or the complete document.
      const fixed=await perform("privacy_repair",{fields:leaves.map(({path,value})=>({path,value}))},repairResponseSchema(leaves.map(l=>l.path)));
      if(new Set(fixed.repairs.map(r=>r.path)).size!==paths.size)throw new Error("team_privacy_rejected");
      const clone=structuredClone(result);
      for(const leaf of leaves){
        const replacement=fixed.repairs.find(r=>r.path===leaf.path)?.replacement;
        if(!replacement||!preservesReportFacts(leaf.value,replacement,d.primary.maturity))throw new Error("team_numeric_integrity");
        let target:unknown=clone;for(const token of leaf.tokens.slice(0,-1))target=(target as Record<string|number,unknown>)[token];
        (target as Record<string|number,unknown>)[leaf.tokens.at(-1)!]=replacement;
      }
      result=schema.parse(clone);const final=inspectTeamOutputPrivacy(result,corpus);if(final.policyViolation||final.overlaps.length)throw new Error("team_privacy_rejected");
    }
    await databaseValidate(result);options.emit?.({stage,status:"privacy_validated",outputSHA256:hash(result),elapsedMs:Date.now()-started});return result;
  };
  if(variant==="A"){
    const synthesis=await invoke("baseline_synthesis",options.qualitative,teamSynthesisV3Schema);
    qualitativeCoverage(options.qualitative,synthesis);
    const input=mainTeamReportInputV3(options.aggregates,synthesis),report=await invoke("baseline_report",input,teamReportV3Schema);
    validateCoreQuality(report,"openai",synthesis);
    return {status:"owner_review_required" as const,variant,calls,report,review:null,signals:repetitionSignals(stringLeaves(report))};
  }
  const cards=await invoke("extract",d.extraction,cardsSchema);validateCards(cards,d);for(const c of cards.cards)known.add(c.id);
  options.emit?.({stage:"extract",status:"contract_validated"});
  if(variant==="B"){
    const generated=await invoke("combined",{PRIMARY_CORE_EVIDENCE:{...d.primary,cards},TEAM_DYNAMICS_EVIDENCE:d.dynamics},groundedCombinedSchema(known));
    const draft=flattenGroundedDraft(generated);
    validateDraft(draft,known,d);
    options.emit?.({stage:"combined",status:"contract_validated"});
    const report=qualityReportSchema.parse({...draft.content,participant_count:d.primary.participant_count,team_analysis:generated.team_analysis});
    await finalGate(report);
    return {status:"owner_review_required" as const,variant,calls,report,review:null,signals:repetitionSignals(stringLeaves(report))};
  }
  const diagnosis=await invoke("diagnose",{primary:d.primary,cards},diagnosisSchema);validateDiagnoses(diagnosis,known);for(const v of diagnosis.diagnoses)known.add(v.id);
  const program=await invoke("program",{primary:d.primary,cards,diagnosis},programSchema);validateProgram(program,diagnosis);
  for(const i of program.initiatives){known.add(i.id);for(const a of i.actions)known.add(a.id);}
  const generatedCore=await invoke("core",{primary:d.primary,cards,diagnosis,program},groundedDraftSchema(known));
  const core=flattenGroundedDraft(generatedCore);validateDraft(core,known,d);
  if(diagnosis.diagnoses.length)for(const field of ["main_diagnosis","growth_constraint"]){
    if(!core.support.find(s=>s.path===field)?.refs.some(ref=>diagnosis.diagnoses.some(d=>d.id===ref)))throw new QualityReferenceError("missing_diagnosis_ref");
  }
  for(const [prefix,phase] of [["first_actions","immediate"],["plan_30_days","30"],["plan_60_days","60"],["plan_90_days","90"]]){
    const actions=new Set(program.initiatives.flatMap(i=>i.actions).filter(a=>a.phase===phase).map(a=>a.id));
    if(actions.size&&core.support.filter(s=>s.path.startsWith(prefix+"[")).some(s=>!s.refs.some(ref=>actions.has(ref))))throw new QualityReferenceError("missing_phase_action_ref");
  }
  options.emit?.({stage:"core",status:"contract_validated"});
  const dynamics=await invoke("dynamics",{dynamics:d.dynamics,cards},dynamicsSchema);
  const report:QualityReport=qualityReportSchema.parse({...core.content,participant_count:d.primary.participant_count,team_analysis:dynamics});
  await finalGate(report);
  const signals=repetitionSignals(stringLeaves(report));
  const review=await invoke("review",{primary:d.primary,dynamics:d.dynamics,cards,diagnosis,program,support:core.support,report,signals},reviewSchema);
  if(review.verdict!=="pass"||review.defects.length)throw new Error("team_quality_rejected");
  return {status:"owner_review_required" as const,variant,calls,report,review,signals};
}
