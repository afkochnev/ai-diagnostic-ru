import { teamReportV2Schema } from "@/server/team/report-v2-contracts";
import Image from "next/image";
import { DynamicsEvidence } from "./dispersion";
import type { DispersionProfile } from "@/shared/analytics/dispersion";

export const teamCoreSections = [
  ["Краткое резюме", "summary"], ["Главный управленческий диагноз", "main_diagnosis"],
  ["Что означает командный индекс управляемости", "manageability_index_text"],
  ["Сильные стороны системы управления", "strengths"], ["Ключевые проблемные зоны", "key_problem_zones"],
  ["Главное ограничение роста", "growth_constraint"], ["Риски, если ничего не менять", "implementation_risks"],
  ["Первые действия руководителя", "first_actions"], ["План на 30 дней", "plan_30_days"],
  ["План на 60 дней", "plan_60_days"], ["План на 90 дней", "plan_90_days"], ["Следующий рекомендуемый шаг", "next_step"],
] as const;
export const teamDynamicsSections = [
  ["Карта согласия команды", "alignment"], ["Карта расхождений", "divergence"],
  ["Анонимные качественные сигналы", "qualitative_signals"], ["Вопросы для управленческой сессии", "discussion_questions"],
] as const;
function Section({ number, title, value,profile,descending,id }: { id?:string; number: number; title: string; value: string | string[];profile?:DispersionProfile;descending?:boolean }) {
  return <section id={id} className="scroll-mt-6 rounded-2xl border border-line bg-white p-6">
    <h3 className="text-lg font-semibold">{number}. {title}</h3>
    {Array.isArray(value) ? value.length ? <ul className="mt-3 list-disc space-y-3 pl-5">{value.map((point, i) => <li key={i} className="whitespace-pre-wrap leading-relaxed">{point}</li>)}</ul> : <p className="mt-3 text-muted">Недостаточно допустимых свидетельств для отдельного вывода.</p> : <div className="mt-3 space-y-3 leading-relaxed">{value.split(/\n\s*\n/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>}
    {profile && <DynamicsEvidence profile={profile} descending={descending}/>}
  </section>;
}
export function RichTeamReport({ content, pipeline="TEAM-RU-2",profile,idPrefix="team-report" }: { content: unknown; pipeline?: string;profile?:DispersionProfile;idPrefix?:string }) {
  const parsed = teamReportV2Schema.safeParse(content);
  if (!parsed.success) return <p role="alert" className="mt-4">Не удалось отобразить формат отчёта.</p>;
  const report = parsed.data;
  return <article className="mt-5 space-y-5">
    <div className="flex items-center justify-between gap-4"><Image src="/brand/iteam-logo-no-tagline.png" alt="iTeam" width={144} height={45} className="h-auto w-36" unoptimized/><a href="https://iteam.ru" target="_blank" rel="noreferrer" className="underline">iteam.ru</a></div>
    <details className="rounded-xl bg-tint p-4"><summary className="cursor-pointer font-semibold">Разделы отчёта</summary><nav aria-label="Разделы командного AI-отчёта" className="mt-3 grid gap-2 sm:grid-cols-2">{[...teamCoreSections,...teamDynamicsSections].map(([title,key])=><a key={key} className="underline" href={`#${idPrefix}-${key}`}>{title}</a>)}</nav></details>
    {teamCoreSections.map(([title, key], i) => <Section key={key} id={`${idPrefix}-${key}`} number={i+1} title={title} value={report[key]} />)}
    <h3 className="pt-4 text-xl font-semibold">Командная динамика</h3>
    {teamDynamicsSections.map(([title, key], i) => <Section key={key} id={`${idPrefix}-${key}`} number={i+13} title={pipeline==="TEAM-RU-3" && i===2?"Дополнительные качественные сигналы команды":title} value={report.team_analysis[key]} profile={i<2?profile:undefined} descending={i===1}/>)}
  </article>;
}
