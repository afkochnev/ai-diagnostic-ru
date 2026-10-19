import { it,expect } from "vitest";
import { qualityCase } from "../../scripts/fixtures/team-quality-cases";
import { authoredStageStubs } from "../../scripts/fixtures/team-quality-stage-stubs";
import { buildDossier } from "@/server/team/quality/dossier";
import { systemAssessmentSchema,validateSystemAssessment,renderSystemAssessment } from "@/server/team/quality/system-assessment";
import { runQualityVariant } from "@/server/team/quality/runtime";

it("requires all actual block references, not a local process repeated eight times",()=>{
 const f=qualityCase("production"),d=buildDossier(f.aggregates,f.qualitative),stubs=authoredStageStubs(f);
 const value=systemAssessmentSchema(d).parse((stubs.diagnose as {system_assessment:unknown}).system_assessment);
 expect(()=>validateSystemAssessment(value,d,d.known)).not.toThrow();
 const duplicate=structuredClone(value);duplicate.dimensions[7]=duplicate.dimensions[0];
 expect(()=>validateSystemAssessment(duplicate,d,d.known)).toThrow("quality_reference_invalid");
 const ungrounded=structuredClone(value);ungrounded.dimensions[0].evidence_refs=["overall.mean"];
 expect(()=>validateSystemAssessment(ungrounded,d,d.known)).toThrow("quality_reference_invalid");
 const link=structuredClone(value);link.links=[{from:"block.1.mean",to:"block.3.mean",kind:"hypothesis",explanation:"Проверяемое предположение, а не установленная причина.",evidence_refs:["block.1.mean","overall.mean"]}];
 expect(()=>validateSystemAssessment(link,d,d.known)).toThrow("quality_reference_invalid");
 expect(renderSystemAssessment(value,d)).toContain("Организационная структура");
});
it("shows the entire system inside the existing sixteen sections and keeps dynamics separate",async()=>{
 const f=qualityCase("production"),stubs=authoredStageStubs(f);
 const result=await runQualityVariant({...f,variant:"C",maxCalls:6,deadline:Date.now()+600000,databaseValidate:async()=>{},call:async r=>structuredClone(stubs[r.stage])});
 for(const b of f.aggregates.blocks)expect(result.report.manageability_index_text).toContain(b.title);
 expect(result.report.manageability_index_text).toContain("Числа сами по себе не устанавливают причинные связи");
 expect(Object.keys(result.report)).toHaveLength(14); // twelve core, count, dynamics container
});
it("missing system coverage stops B before the final report gate and never fills it silently",async()=>{
 const f=qualityCase("production"),stubs=authoredStageStubs(f);let calls=0;
 const system=(stubs.combined as {system_assessment:{dimensions:unknown[]}}).system_assessment;system.dimensions.pop();
 await expect(runQualityVariant({...f,variant:"B",maxCalls:2,deadline:Date.now()+600000,databaseValidate:async()=>{},call:async r=>{calls++;return structuredClone(stubs[r.stage]);}})).rejects.toThrow("quality_stage_failed");
 expect(calls).toBe(2);
});
