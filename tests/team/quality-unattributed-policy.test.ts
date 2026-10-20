import { it,expect } from "vitest";
import { qualityCase } from "../../scripts/fixtures/team-quality-cases";
import { authoredStageStubs } from "../../scripts/fixtures/team-quality-stage-stubs";
import { inspectResearchPrivacy } from "@/server/team/quality/privacy-policy";
import { runQualityVariant,type StageRequest } from "@/server/team/quality/runtime";
import { approvedRequestBody } from "@/server/team/quality/openai-port";
import { stagePrompt } from "@/server/team/quality/prompts";
const text="В компании сроки клиенту обещаются до проверки доступности оборудования и загрузки производства.";
it("allows anonymous source wording and anonymous opinions only under the explicit policy",()=>{
 const corpus={threshold:32 as const,answers:[{question_index:1,text}],identifiers:["Иван Петров","Анна"]};
 expect(inspectResearchPrivacy({text},corpus).overlaps).not.toHaveLength(0);
 for(const wording of [text,"По словам участника, оборудование бывает недоступно.","Данная программа содержит согласованные действия."]){
  expect(inspectResearchPrivacy({text:wording},corpus,"unattributed").policyViolation).toBe(false);
  expect(inspectResearchPrivacy({text:wording},corpus,"unattributed").overlaps).toHaveLength(0);
 }
 for(const wording of ["Иван Петров считает иначе.","Петров считает иначе.","Анна считает иначе.","OWNER@EXAMPLE.TEST","https://example.test","20000000-0000-4000-8000-000000000001"])
  expect(inspectResearchPrivacy({text:wording},corpus,"unattributed").policyViolation).toBe(true);
});
it("runs six stages without paid wording repairs while keeping contracts and owner review",async()=>{
 const f=qualityCase("production"),stubs=authoredStageStubs(f),requests:StageRequest[]=[];
 f.corpus.answers.push({question_index:1,text});
 (stubs.extract as {cards:{observation:string}[]}).cards[0].observation=text;
 const r=await runQualityVariant({...f,variant:"C",researchComparison:true,privacyPolicy:"unattributed",maxCalls:12,maxPrivacyRepairs:6,deadline:Date.now()+60000,databaseValidate:async v=>{if(inspectResearchPrivacy(v,f.corpus,"unattributed").policyViolation)throw Error("team_privacy_rejected");},call:async q=>{requests.push(q);return structuredClone(stubs[q.stage]);}});
 expect(requests.map(q=>q.stage)).toEqual(["extract","diagnose","program","core","dynamics","review"]);
 expect(requests.every(q=>q.privacyPolicy==="unattributed")).toBe(true);
 expect(r.status).toBe("owner_review_required");
 const system=approvedRequestBody(requests[0],"gpt-5.6-sol","medium").input[0].content;
 expect(system).not.toContain("из32символов");expect(system).toContain("совпадение формулировки");
 expect(stagePrompt("extract")).toContain("из32символов");
});
it("rejects widening ordinary mode and preserves numeric rejection under the new research policy",async()=>{
 const f=qualityCase("production"),s=authoredStageStubs(f);
 const base={...f,variant:"C" as const,privacyPolicy:"unattributed" as const,maxCalls:12,deadline:Date.now()+60000,databaseValidate:async()=>{},call:async(q:StageRequest)=>structuredClone(s[q.stage])};
 await expect(runQualityVariant(base)).rejects.toThrow("quality_approval_required");
 (s.core as {content:{summary:{text:string}}}).content.summary.text="Средний индекс 999.";
 await expect(runQualityVariant({...base,researchComparison:true})).rejects.toThrow("team_numeric_integrity");
});
