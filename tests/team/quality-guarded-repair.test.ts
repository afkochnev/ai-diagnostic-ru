import { it,expect } from "vitest";
import { guardedRepair,QualityRepairError } from "@/server/team/quality/guarded-repair";
import { stringLeaves,inspectTeamOutputPrivacy,type PrivacyCorpus } from "@/server/team/synthesis-privacy";
import { preservesReportFacts } from "@/server/team/report-privacy";
const raw="Ответственность за процесс не закреплена между подразделениями";
const corpus:PrivacyCorpus={threshold:32,answers:[{question_index:1,text:raw}],identifiers:[]};
const safe="Границы владения задачами требуют уточнения для устойчивого исполнения.";
it("keeps numeric, date, version and maturity statements local and byte-for-byte unchanged",()=>{
 const before=`Индекс 54,6; дата 18.10.2026; TEAM-RU-3. ${raw}.\nЗона развития. Проверка через 30 дней.`;
 const plan=guardedRepair(stringLeaves({summary:before}),"Зона развития",corpus);
 expect(plan.fields).toHaveLength(1);expect(plan.fields[0].value).toBe(raw+".");
 expect(JSON.stringify(plan.fields)).not.toContain("54,6");expect(JSON.stringify(plan.fields)).not.toContain("Зона развития");
 const after=plan.rebuild({repairs:plan.fields.map(f=>({path:f.path,replacement:safe}))})[0].replacement;
 expect(after).toBe(before.replace(raw+".",safe));expect(preservesReportFacts(before,after,"Зона развития")).toBe(true);
 expect(inspectTeamOutputPrivacy({summary:after},corpus).violations).toEqual([]);
});
it("fails before repair when the forbidden fragment is inside an immutable fact statement",()=>{
 const error=(()=>{try{guardedRepair(stringLeaves({summary:`Индекс 54,6: ${raw}.`}),null,corpus);}catch(e){return e;}})();
 expect(error).toBeInstanceOf(QualityRepairError);expect((error as QualityRepairError).safeDetails()).toEqual({reason:"protected_fact_overlap",fieldPath:"summary"});
 expect(JSON.stringify(error)).not.toContain(raw);
});
it("rejects introduced numbers and unknown, missing or duplicate fragment paths",()=>{
 const plan=guardedRepair(stringLeaves({summary:`Индекс 54,6. ${raw}.`}),null,corpus),path=plan.fields[0].path;
 expect(()=>plan.rebuild({repairs:[{path,replacement:"Иная формулировка 99."}]})).toThrow("team_numeric_integrity");
 for(const repairs of [[],[{path:"other",replacement:safe}],[{path,replacement:safe},{path,replacement:safe}]])expect(()=>plan.rebuild({repairs})).toThrow("team_privacy_rejected");
});
it("preserves the old one-field protocol for nonnumeric prose and bounds fragment count",()=>{
 const plan=guardedRepair(stringLeaves({summary:raw}),null,corpus);expect(plan.fields).toEqual([{path:"summary",value:raw}]);
 expect(plan.rebuild({repairs:[{path:"summary",replacement:safe}]})[0].replacement).toBe(safe);
 expect(()=>guardedRepair(stringLeaves(Array.from({length:25},()=>raw)),null,corpus)).toThrow("team_privacy_rejected");
});
