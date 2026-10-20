import { teamReportSchema } from "@/server/team/report-contracts";
export function LegacyTeamReport({ content }: { content: unknown }) {
  const parsed = teamReportSchema.safeParse(content);
  if (!parsed.success) return <p role="alert" className="mt-4">Не удалось отобразить формат отчёта.</p>;
  const report = parsed.data;
  const sections = { strongest_blocks:"Сильные области",weakest_blocks:"Области для улучшения",agreement:"Наиболее согласованные ответы",disagreement:"Наибольший разброс",qualitative_themes:"Анонимные темы",risks:"Риски",priorities:"Приоритеты",next_steps:"Практические шаги" } as const;
  return <article className="mt-4 space-y-4"><p>{report.executive_summary}</p><p>{report.maturity}</p>{Object.entries(sections).map(([key,title]) => <section key={key}><h3 className="font-semibold">{title}</h3><ul className="mt-2 list-disc space-y-1 pl-5">{report[key as keyof typeof sections].map((point,i) => <li key={i}>{point}</li>)}</ul></section>)}</article>;
}
