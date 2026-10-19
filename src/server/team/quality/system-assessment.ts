import { z } from "zod";
import { requireRefs,QualityReferenceError } from "./contracts";
import type { Dossier } from "./dossier";

const statement=z.string().min(1).max(2000);
/** Explicit analytical lenses, not claims about how this particular company operates. */
export const systemFunctions=[
  "Выбор направления и приоритетов", "Распределение ответственности и прав решений",
  "Организация исполнения", "Перевод целей в измеримый результат", "Обратная связь и корректировка решений",
  "Способность команды выполнять принятые решения", "Обновление и развитие системы", "Повседневные нормы взаимодействия",
];
export function systemAssessmentSchema(d:Dossier) {
  const blockRefs=d.primary.blocks.map(b=>`block.${b.position}.mean`) as [string,...string[]];
  const block=z.enum(blockRefs),ref=z.enum([...d.known].sort() as [string,...string[]]);
  // Card references are appended by the caller once extraction has passed its gates.
  return z.strictObject({
    system_state:statement,
    dimensions:z.array(z.strictObject({block_ref:block,assessment:statement,limitations:z.array(statement).max(3),evidence_refs:z.array(ref).min(1).max(20)})).length(8),
    links:z.array(z.strictObject({from:block,to:block,kind:z.enum(["observation","hypothesis","not_established"]),explanation:statement,evidence_refs:z.array(ref).min(2).max(20)})).max(4),
    limits:statement,
  });
}
export type SystemAssessment=z.infer<ReturnType<typeof systemAssessmentSchema>>;
export function validateSystemAssessment(value:SystemAssessment,d:Dossier,known:Set<string>) {
  const expected=new Set(d.primary.blocks.map(b=>`block.${b.position}.mean`));
  if(value.dimensions.length!==8||new Set(value.dimensions.map(b=>b.block_ref)).size!==8||value.dimensions.some(b=>!expected.has(b.block_ref)||!b.evidence_refs.includes(b.block_ref)))throw new QualityReferenceError("system_coverage_invalid");
  for(const row of value.dimensions)requireRefs(row.evidence_refs,known);
  for(const link of value.links){
    if(!expected.has(link.from)||!expected.has(link.to)||link.from===link.to||!link.evidence_refs.includes(link.from)||!link.evidence_refs.includes(link.to))throw new QualityReferenceError("system_link_invalid");
    requireRefs(link.evidence_refs,known);
  }
}
/** Visible in the existing index/system section, without adding a seventeenth section. */
export function renderSystemAssessment(value:SystemAssessment,d:Dossier) {
  const rows=value.dimensions.map(row=>{
    const b=d.primary.blocks.find(b=>`block.${b.position}.mean`===row.block_ref)!;
    return `${b.title}: ${Math.round(b.mean*10)/10} из 100. ${row.assessment}${row.limitations.length?` Ограничения: ${row.limitations.join(" ")}`:""}`;
  });
  const links=value.links.map(l=>`${l.kind==="hypothesis"?"Проверяемая гипотеза связи":l.kind==="not_established"?"Связь пока не установлена":"Наблюдаемая связь"}: ${l.explanation}`);
  return ["Система управления в целом",value.system_state,...rows,...links,`Пределы оценки: ${value.limits}`].join("\n\n");
}
