import { z } from "zod";

export const QUALITY_VERSION = "TEAM-QUALITY-PROTOTYPE-4.1-SYSTEM";
const text = z.string().min(1).max(12000);
const points = z.array(text).max(12);
const ref = z.string().regex(/^(?:overall\.(?:mean|maturity)|block\.\d+\.mean|question\.\d+\.\d+\.mean|context\.[a-z_]+|E\d+|D\d+|I\d+|A\d+)$/);
export const coreSchema = z.strictObject({
  summary:text,main_diagnosis:text,manageability_index_text:text,strengths:points,key_problem_zones:points,
  growth_constraint:text,implementation_risks:points,first_actions:points,plan_30_days:points,plan_60_days:points,plan_90_days:points,next_step:text,
});
export const dynamicsSchema = z.strictObject({alignment:points,divergence:points,qualitative_signals:points,discussion_questions:points});
export const qualityReportSchema = coreSchema.extend({participant_count:z.number().int().min(3),team_analysis:dynamicsSchema});
export type QualityReport = z.infer<typeof qualityReportSchema>;
export const cardsSchema = z.strictObject({cards:z.array(z.strictObject({
  id:z.string().regex(/^E\d+$/),question_position:z.number().int().positive(),observation:text,
  consequence:z.string().max(4000).nullable(),limitations:points,
})).max(24),omitted_groups:z.array(z.strictObject({question_position:z.number().int().positive(),reason:text})).max(4),limitations:points});
export type Cards = z.infer<typeof cardsSchema>;
export const diagnosisSchema = z.strictObject({diagnoses:z.array(z.strictObject({
  id:z.string().regex(/^D\d+$/),claim:text,kind:z.enum(["observation","hypothesis"]),evidence_refs:z.array(ref).min(1).max(20),
  goal_ref:z.string().regex(/^context\.[a-z_]+$/).nullable(),mechanism:text,business_effect:text,alternatives:points,limitations:points,test:text,
})).max(3),limitations:points});
export type Diagnoses = z.infer<typeof diagnosisSchema>;
export const programSchema = z.strictObject({initiatives:z.array(z.strictObject({
  id:z.string().regex(/^I\d+$/),diagnosis_refs:z.array(z.string().regex(/^D\d+$/)).min(1),barrier:text,expected_effect:text,
  actions:z.array(z.strictObject({id:z.string().regex(/^A\d+$/),phase:z.enum(["immediate","30","60","90"]),
    action:text,proposed_role:text,deliverable:text,verification:text,depends_on:z.array(z.string().regex(/^A\d+$/)).max(12),
  })).min(1).max(16),
})).max(3),limitations:points});
export type Program = z.infer<typeof programSchema>;
export const draftSchema = z.strictObject({content:coreSchema,support:z.array(z.strictObject({
  path:z.string().regex(/^[a-z_][a-z0-9_]*(?:\[\d+\])?$/),refs:z.array(ref).min(1).max(30),
})).max(150)});
export const combinedDraftSchema = draftSchema.extend({team_analysis:dynamicsSchema});

// The model never has to repeat paragraph paths in a second, parallel array.
// Every generated paragraph carries its own mandatory, bounded provenance.
export function groundedDraftSchema(known:ReadonlySet<string>) {
  if(!known.size)throw new Error("quality_reference_invalid");
  const paragraph=z.strictObject({text,refs:z.array(z.enum([...known].sort() as [string,...string[]])).min(1).max(30)});
  const list=z.array(paragraph).max(12);
  return z.strictObject({content:z.strictObject({
    summary:paragraph,main_diagnosis:paragraph,manageability_index_text:paragraph,strengths:list,key_problem_zones:list,
    growth_constraint:paragraph,implementation_risks:list,first_actions:list,plan_30_days:list,plan_60_days:list,plan_90_days:list,next_step:paragraph,
  })});
}
export function groundedCombinedSchema(known:ReadonlySet<string>) {
  return groundedDraftSchema(known).extend({team_analysis:dynamicsSchema});
}
export type GroundedDraft=z.infer<ReturnType<typeof groundedDraftSchema>>;
export function flattenGroundedDraft(value:GroundedDraft):z.infer<typeof draftSchema> {
  const content:Record<string,string|string[]>={},support:z.infer<typeof draftSchema>["support"]=[];
  for(const [field,item] of Object.entries(value.content)){
    if(Array.isArray(item)){
      content[field]=item.map(p=>p.text);
      item.forEach((p,index)=>support.push({path:`${field}[${index}]`,refs:p.refs}));
    }else{content[field]=item.text;support.push({path:field,refs:item.refs});}
  }
  return draftSchema.parse({content,support});
}
export const defectCodes = ["unsupported","causality","numeric","repetition","unclear","generic","unlinked_action","lost_evidence","core_dynamics","system_scope","privacy"] as const;
export const reviewSchema = z.strictObject({verdict:z.enum(["pass","fail"]),defects:z.array(z.strictObject({
  path:text,code:z.enum(defectCodes),critical:z.boolean(),reason:text,required_change:text,
})).max(40)});
export type Review = z.infer<typeof reviewSchema>;
/** Carries only a critic result that already passed local+DB privacy, never a rejected report. */
export class QualityCriticRejection extends Error {
  readonly review:Review;
  constructor(review:Review){super("team_quality_rejected");this.review=structuredClone(review);}
}

export function uniqueIds(values:{id:string}[]) {
  if(new Set(values.map(v=>v.id)).size!==values.length) throw new QualityReferenceError("duplicate_id");
}
export class QualityReferenceError extends Error {
  constructor(readonly reason:"duplicate_id"|"unknown_evidence_ref"|"duplicate_support_path"|"unknown_support_path"|"missing_support_path"|"missing_diagnosis_ref"|"missing_phase_action_ref"|"system_coverage_invalid"|"system_link_invalid") {super("quality_reference_invalid");}
}
/** Safe failure location only: never retain the rejected number or surrounding prose. */
export class QualityNumericError extends Error {
  constructor(readonly fieldPath:string){super("team_numeric_integrity");}
  safeDetails(){return {reason:"literal_not_in_frozen_facts_or_proposal_horizons",field_path:this.fieldPath};}
}
export function requireRefs(refs:string[],known:Set<string>) {
  if(refs.some(r=>!known.has(r))) throw new QualityReferenceError("unknown_evidence_ref");
}
