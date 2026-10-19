import { it,expect } from "vitest";
import { qualityCase } from "../../scripts/fixtures/team-quality-cases";
import { authoredStageStubs } from "../../scripts/fixtures/team-quality-stage-stubs";
import { buildDossier } from "@/server/team/quality/dossier";
import { runQualityVariant,validatePrimaryText } from "@/server/team/quality/runtime";
import { QualityNumericError } from "@/server/team/quality/contracts";

it("accepts frozen sample counts without broadening allowed metric precision",()=>{
  const f=qualityCase("production"),d=buildDossier(f.aggregates,f.qualitative);
  expect(()=>validatePrimaryText({limits:`Завершили ${d.primary.participant_count}. Рассмотрены ${d.primary.blocks.length} блоков и ${d.primary.questions.length} вопросов.`},d)).not.toThrow();
  expect(()=>validatePrimaryText({summary:"Показатель равен 999."},d)).toThrow("team_numeric_integrity");
  expect(()=>validatePrimaryText({summary:"Показатель равен 42,51."},d)).toThrow("team_numeric_integrity");
});

it("uses the actual participant count rather than a fixed allowance for three",()=>{
  const f=qualityCase("production");f.aggregates.participant_count=20;f.aggregates.overall.participant_count=20;
  for(const b of f.aggregates.blocks)b.participant_count=20;
  for(const q of f.aggregates.questions){q.participant_count=20;q.distribution=q.distribution.map(n=>n*5);}
  const d=buildDossier(f.aggregates,f.qualitative);
  expect(()=>validatePrimaryText({limits:"Завершили 20 участников."},d)).not.toThrow();
  expect(()=>validatePrimaryText({limits:"Завершили 19 участников."},d)).toThrow("team_numeric_integrity");
});

it("retains exact and one-decimal source means and rejects unrelated literals",()=>{
  const f=qualityCase("production"),d=buildDossier(f.aggregates,f.qualitative);
  const n=d.primary.overall_mean;
  expect(()=>validatePrimaryText({summary:`Индекс ${n}. Округлённый индекс ${Math.round(n*10)/10}.`},d)).not.toThrow();
  expect(()=>validatePrimaryText({summary:"Индекс 998,7."},d)).toThrow("team_numeric_integrity");
});

it("records only the rejected field path and reason, never its number or text",()=>{
  const f=qualityCase("production"),d=buildDossier(f.aggregates,f.qualitative);
  let failure:QualityNumericError|undefined;
  try{validatePrimaryText({dimensions:[{assessment:"Секретный пример с числом 987654."}]},d);}catch(e){if(e instanceof QualityNumericError)failure=e;else throw e;}
  expect(failure).toBeInstanceOf(QualityNumericError);
  expect(failure!.safeDetails()).toEqual({reason:"literal_not_in_frozen_facts_or_proposal_horizons",field_path:"dimensions[0].assessment"});
  expect(JSON.stringify(failure!.safeDetails())).not.toMatch(/987654|Секретный/);
});

it("stops at the generated system field before program generation on unknown numbers",async()=>{
  const f=qualityCase("production"),stubs=authoredStageStubs(f),stages:string[]=[];
  const system=(stubs.diagnose as {system_assessment:{dimensions:Record<string,{assessment:string}>}}).system_assessment;
  system.dimensions[Object.keys(system.dimensions)[2]].assessment="Неизвестный показатель 987654.";
  let failure:QualityNumericError|undefined;
  try{await runQualityVariant({...f,variant:"C",maxCalls:6,deadline:Date.now()+60000,databaseValidate:async()=>{},call:async r=>{stages.push(r.stage);return structuredClone(stubs[r.stage]);}});}catch(e){if(e instanceof QualityNumericError)failure=e;else throw e;}
  expect(stages).toEqual(["extract","diagnose"]);
  expect(failure!.safeDetails().field_path).toBe("dimensions[2].assessment");
});

it("still rejects dynamics in the primary section even beside valid sample counts",()=>{
  const f=qualityCase("production"),d=buildDossier(f.aggregates,f.qualitative);
  expect(()=>validatePrimaryText({summary:"Оценены 8 блоков. Разброс подтверждает конфликт."},d)).toThrow("team_quality_rejected");
});
