import { it,expect } from "vitest";
import { qualityCase } from "../../scripts/fixtures/team-quality-cases";
import { authoredStageStubs } from "../../scripts/fixtures/team-quality-stage-stubs";
import { buildDossier } from "@/server/team/quality/dossier";
import { runQualityVariant,validatePrimaryText,type StageRequest } from "@/server/team/quality/runtime";
import { primaryEditorialSignals,QualityTextError } from "@/server/team/quality/text-signals";

const businessDifference="Расхождение обещанного и фактического срока отгрузки требует проверки по журналу заказов.";
function setup(){
 const f=qualityCase("production"),stubs=authoredStageStubs(f),requests:StageRequest[]=[];
 const assessment=(stubs.diagnose as {system_assessment:{dimensions:Record<string,{assessment:string}>}}).system_assessment;
 assessment.dimensions[Object.keys(assessment.dimensions)[0]].assessment=businessDifference;
 return {f,stubs,requests,call:async(r:StageRequest)=>{requests.push(r);return structuredClone(stubs[r.stage]);}};
}
it("word matches cannot distinguish operational differences from respondent dynamics",()=>{
 const positive=primaryEditorialSignals({assessment:businessDifference});
 const negative=primaryEditorialSignals({assessment:"Расхождение оценок участников доказывает конфликт."});
 expect(positive).toEqual(negative); // Demonstrates the limitation, not semantic equivalence.
 expect(positive).toEqual([{path:"assessment",code:"dynamics_lexeme"}]);
 expect(JSON.stringify(positive)).not.toContain("отгрузки");
});
it("keeps the strict ordinary-mode lexical stop and records no rejected text",async()=>{
 const s=setup();let failure:QualityTextError|undefined;
 try{await runQualityVariant({...s.f,variant:"C",maxCalls:6,deadline:Date.now()+60000,call:s.call,databaseValidate:async()=>{}});}catch(e){if(e instanceof QualityTextError)failure=e;else throw e;}
 expect(s.requests.map(r=>r.stage)).toEqual(["extract","diagnose"]);
 expect(failure!.safeDetails()).toEqual({reason:"editorial_lexeme_match",field_path:"dimensions[0].assessment",code:"dynamics_lexeme"});
 expect(JSON.stringify(failure!.safeDetails())).not.toContain(businessDifference);
});
it("routes research signals to the same final critic without adding calls or accepting quality",async()=>{
 const s=setup(),result=await runQualityVariant({...s.f,variant:"C",researchComparison:true,maxCalls:6,deadline:Date.now()+60000,call:s.call,databaseValidate:async()=>{}});
 expect(s.requests.map(r=>r.stage)).toEqual(["extract","diagnose","program","core","dynamics","review"]);
 expect(result.editorialSignals).toEqual([{path:"system_assessment.dimensions[0].assessment",code:"dynamics_lexeme"}]);
 expect((s.requests.at(-1)!.input as {editorialSignals:unknown}).editorialSignals).toEqual(result.editorialSignals);
 expect(result.status).toBe("owner_review_required");
 // Physical exclusion remains independent of lexical interpretation.
 for(const r of s.requests.filter(r=>["diagnose","program","core"].includes(r.stage)))expect(JSON.stringify(r.input)).not.toMatch(/"(?:stddev_pop|min|max|distribution)"\s*:/);
});
it("research routing does not bypass unknown numerical literals",async()=>{
 const s=setup(),system=(s.stubs.diagnose as {system_assessment:{system_state:string}}).system_assessment;
 system.system_state="Расхождение требует проверки. Индекс 987654.";
 await expect(runQualityVariant({...s.f,variant:"C",researchComparison:true,maxCalls:6,deadline:Date.now()+60000,call:s.call,databaseValidate:async()=>{}})).rejects.toThrow("team_numeric_integrity");
 expect(s.requests.map(r=>r.stage)).toEqual(["extract","diagnose"]);
});
it.each(["numeric","privacy"] as const)("critic %s defects still hard-stop after a research lexical signal",async code=>{
 const s=setup();s.stubs.review={verdict:"fail",defects:[{path:"summary",code,critical:true,reason:"Критическая проверка не пройдена.",required_change:"Проверить фактические основания."}]};
 await expect(runQualityVariant({...s.f,variant:"C",researchComparison:true,maxCalls:6,deadline:Date.now()+60000,call:s.call,databaseValidate:async()=>{}})).rejects.toThrow("team_quality_rejected");
 expect(s.requests).toHaveLength(6);
});
it("all service/style signals remain visible in research and strict mode still rejects them",()=>{
 const f=qualityCase("production"),d=buildDossier(f.aggregates,f.qualitative),received:unknown[]=[];
 const text={summary:"Качественные ответы дополняют средний профиль."};
 expect(()=>validatePrimaryText(text,d)).toThrow("team_quality_rejected");
 validatePrimaryText(text,d,s=>received.push(s));expect(received).toEqual([{path:"summary",code:"service_phrase"}]);
});
