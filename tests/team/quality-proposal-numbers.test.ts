import { it,expect } from "vitest";
import { qualityCase } from "../../scripts/fixtures/team-quality-cases";
import { authoredStageStubs } from "../../scripts/fixtures/team-quality-stage-stubs";
import { buildDossier } from "@/server/team/quality/dossier";
import { validateDraft,runQualityVariant } from "@/server/team/quality/runtime";
import { flattenGroundedDraft,type GroundedDraft,type Program } from "@/server/team/quality/contracts";

function sample(){
 const f=qualityCase("production"),d=buildDossier(f.aggregates,f.qualitative),stubs=authoredStageStubs(f),program=stubs.program as Program;
 program.initiatives[0].actions.find(a=>a.phase==="30")!.action="Разобрать 20–30 последовательных заказов и зафиксировать причины ожидания.";
 const draft=flattenGroundedDraft(stubs.core as GroundedDraft),known=new Set([...d.known,"E1","D1","I1",...program.initiatives.flatMap(i=>i.actions).map(a=>a.id)]);
 draft.content.plan_30_days=["Предлагается разобрать 20–30 заказов и проверить причины ожидания."];
 draft.support=draft.support.filter(s=>!s.path.startsWith("plan_30_days["));draft.support.push({path:"plan_30_days[0]",refs:[program.initiatives[0].actions.find(a=>a.phase==="30")!.id]});
 return {f,d,stubs,program,draft,known};
}
it("reproduces the old rejection and permits only an explicitly proposed, action-grounded sample",()=>{
 const s=sample();expect(()=>validateDraft(s.draft,s.known,s.d)).toThrow("team_numeric_integrity");
 expect(()=>validateDraft(s.draft,s.known,s.d,undefined,s.program)).not.toThrow();
});
it.each([
 "Средний индекс равен 20. Предлагается проверить сроки.",
 "Проанализированы 20–30 заказов.",
 "Предлагается разобрать 21–30 заказов.",
 "Предлагается разобрать 20–30 проектов.",
 "Предлагается опросить 20–30 участников.",
 "Предлагается увеличить прибыль на 20 процентов.",
 "Предлагается разобрать 20–30 заказов; индекс составляет 20.",
 "Предлагается разобрать 20–30 заказов. Сейчас просрочены 20–30 заказов.",
 "Предлагается разобрать 20–30 заказов, текущий индекс равен 20.",
])("does not turn the proposal into an allowance for ungrounded or measured numbers: %s",text=>{
 const s=sample();s.draft.content.plan_30_days=[text];expect(()=>validateDraft(s.draft,s.known,s.d,undefined,s.program)).toThrow("team_numeric_integrity");
});
it("requires the matching action and phase and never widens summary or index text",()=>{
 const s=sample();s.draft.support.find(r=>r.path==="plan_30_days[0]")!.refs=["E1"];
 expect(()=>validateDraft(s.draft,s.known,s.d,undefined,s.program)).toThrow("team_numeric_integrity");
 const t=sample();t.program.initiatives[0].actions.find(a=>a.phase==="30")!.phase="60";
 expect(()=>validateDraft(t.draft,t.known,t.d,undefined,t.program)).toThrow("team_numeric_integrity");
 const u=sample();u.draft.content.summary="Предлагается разобрать 20–30 заказов.";
 expect(()=>validateDraft(u.draft,u.known,u.d,undefined,u.program)).toThrow("team_numeric_integrity");
});
it("keeps the edited full system narrative and replays the saved analysis before only three new stages",async()=>{
 const s=sample(),core=s.stubs.core as GroundedDraft;
 core.content.manageability_index_text.refs=[...s.d.primary.blocks.map(b=>`block.${b.position}.mean`)];
 core.content.manageability_index_text.text="Компания нуждается в согласованном управлении производством и развитием продуктов.";
 core.content.plan_30_days=[{text:s.draft.content.plan_30_days[0],refs:s.draft.support.find(r=>r.path==="plan_30_days[0]")!.refs}];
 const stages:string[]=[];const r=await runQualityVariant({...s.f,variant:"C",researchComparison:true,privacyPolicy:"unattributed",editorialSystemText:true,maxCalls:12,deadline:Date.now()+60000,databaseValidate:async()=>{},call:async q=>{stages.push(q.stage);return structuredClone(s.stubs[q.stage]);}});
 expect(stages).toEqual(["extract","diagnose","program","core","dynamics","review"]);
 expect(r.report.manageability_index_text).toBe(core.content.manageability_index_text.text);
});
