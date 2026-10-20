import { it,expect } from "vitest";
import { qualityCase } from "../../scripts/fixtures/team-quality-cases";
import { authoredStageStubs } from "../../scripts/fixtures/team-quality-stage-stubs";
import { runQualityVariant,type StageRequest } from "@/server/team/quality/runtime";
const raw="Особая закрытая формулировка о причинах невозможности выполнить принятое обязательство";
function fixture(){
 const f=qualityCase("production"),s=authoredStageStubs(f);f.corpus={threshold:32,identifiers:[],answers:[{question_index:1,text:raw}]};
 (s.extract as {cards:{observation:string}[]}).cards[0].observation=raw;
 (s.diagnose as {system_assessment:{system_state:string}}).system_assessment.system_state=raw;
 (s.program as {initiatives:{barrier:string}[]}).initiatives[0].barrier=raw;
 (s.core as {content:{summary:{text:string}}}).content.summary.text=raw;
 (s.dynamics as {alignment:string[]}).alignment[0]=raw;
 s.review={verdict:"fail",defects:[{path:"summary",code:"unclear",critical:false,reason:raw,required_change:"Уточнить проверяемое утверждение."}]};
 const stages:string[]=[];
 const call=async(r:StageRequest)=>{stages.push(r.stage);return r.stage==="privacy_repair"?{repairs:(r.input as {fields:{path:string}[]}).fields.map(x=>({path:x.path,replacement:"Проверка гипотезы требует сопоставления решений с подтверждёнными рабочими случаями."}))}:structuredClone(s[r.stage]);};
 return {f,s,stages,call};
}
it("allows one bounded repair at each research stage when explicitly configured, at most twelve total calls",async()=>{
 const t=fixture(),r=await runQualityVariant({...t.f,variant:"C",researchComparison:true,maxPrivacyRepairs:6,maxCalls:12,deadline:Date.now()+60000,databaseValidate:async()=>{},call:t.call});
 expect(t.stages).toHaveLength(12);expect(t.stages.filter(s=>s==="privacy_repair")).toHaveLength(6);expect(r.status).toBe("owner_review_required");
});
it("keeps the two-repair default and forbids widening ordinary-mode limits",async()=>{
 const t=fixture();await expect(runQualityVariant({...t.f,variant:"C",researchComparison:true,maxCalls:12,deadline:Date.now()+60000,databaseValidate:async()=>{},call:t.call})).rejects.toThrow("team_privacy_rejected");
 expect(t.stages).toEqual(["extract","privacy_repair","diagnose","privacy_repair","program"]);
 for(const researchComparison of [false,true])await expect(runQualityVariant({...t.f,variant:"C",researchComparison,maxPrivacyRepairs:researchComparison?7:6,maxCalls:20,deadline:Date.now()+60000,databaseValidate:async()=>{},call:t.call})).rejects.toThrow("quality_approval_required");
});
it("does not retry an unsuccessful repair even with unused global allowance",async()=>{
 const t=fixture();await expect(runQualityVariant({...t.f,variant:"C",researchComparison:true,maxPrivacyRepairs:6,maxCalls:12,deadline:Date.now()+60000,databaseValidate:async()=>{},call:async r=>r.stage==="privacy_repair"?{repairs:(r.input as {fields:{path:string}[]}).fields.map(x=>({path:x.path,replacement:raw}))}:t.call(r)})).rejects.toThrow("team_privacy_rejected");
 expect(t.stages).toEqual(["extract"]);
});
