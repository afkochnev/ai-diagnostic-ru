import { teamReportV2Schema } from "@/server/team/report-v2-contracts";

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
function Section({ number, title, value }: { number: number; title: string; value: string | string[] }) {
  return <section className="rounded-2xl border border-line bg-white p-6">
    <h3 className="text-lg font-semibold">{number}. {title}</h3>
    {Array.isArray(value) ? value.length ? <ul className="mt-3 list-disc space-y-3 pl-5">{value.map((point, i) => <li key={i} className="whitespace-pre-wrap leading-relaxed">{point}</li>)}</ul> : <p className="mt-3 text-muted">Недостаточно допустимых свидетельств для отдельного вывода.</p> : <div className="mt-3 space-y-3 leading-relaxed">{value.split(/\n\s*\n/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>}
  </section>;
}
export function RichTeamReport({ content }: { content: unknown }) {
  const parsed = teamReportV2Schema.safeParse(content);
  if (!parsed.success) return <p role="alert" className="mt-4">Не удалось отобразить формат отчёта.</p>;
  const report = parsed.data;
  return <article className="mt-5 space-y-5">
    {teamCoreSections.map(([title, key], i) => <Section key={key} number={i+1} title={title} value={report[key]} />)}
    <h3 className="pt-4 text-xl font-semibold">Командная динамика</h3>
    {teamDynamicsSections.map(([title, key], i) => <Section key={key} number={i+13} title={title} value={report.team_analysis[key]} />)}
  </article>;
}
