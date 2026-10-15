import { Card } from "@/components/ui/card";
import { orderDispersion, type TeamResults, type TeamStatistic } from "@/server/team/results";
import { TeamResultForm } from "./result-actions";
const number = (n: number | string) => Number(n).toLocaleString("ru-RU",{maximumFractionDigits:1});
function Statistics({ rows }: { rows: TeamStatistic[] }) {
  return <ul className="mt-3 space-y-3">{rows.map(r=><li key={r.block_id ?? r.question_id}><p className="font-medium">{r.title ?? r.prompt}</p><p className="text-sm text-muted">Среднее {number(r.mean_score)} · Разброс {number(r.stddev_score)} · От {number(r.min_score)} до {number(r.max_score)} · Ответов: {r.participant_count}</p></li>)}</ul>;
}
export function TeamResultsView({ teamId, result }: { teamId: string; result: TeamResults }) {
  if(result.status === "threshold") return <Card className="mt-8"><h2 className="text-xl font-semibold">Командный результат</h2><p className="mt-3">Для командного результата необходимо минимум 3 завершивших участника.</p></Card>;
  const blocks=result.blocks ?? [], questions=result.questions ?? [];
  const current=result.reports?.find(r=>r.source_fingerprint===result.fingerprint);
  const sections = { strongest_blocks:"Сильные области",weakest_blocks:"Области для улучшения",agreement:"Наиболее согласованные ответы",disagreement:"Наибольший разброс",qualitative_themes:"Анонимные темы",risks:"Риски",priorities:"Приоритеты",next_steps:"Практические шаги" } as const;
  return <><Card className="mt-8"><h2 className="text-2xl font-semibold">Командный результат</h2><p className="mt-2">Завершивших участников: {result.completed_count}</p>
    {result.status==="pending" ? <><p className="mt-4">Результаты рассчитываются.</p>{result.aggregate_error && <p className="mt-2">Расчёт не завершён. Можно повторить попытку.</p>}<TeamResultForm teamId={teamId} intent="refresh" label="Обновить расчёт" /></> : <>
      <p className="mt-4 text-xl">Средний индекс: {number(result.overall!.overall_mean)} из 100</p><p className="mt-2">{result.maturity} — уровень командного среднего.</p><p className="mt-2 text-sm text-muted">Разброс: {number(result.overall!.overall_stddev)} · От {number(result.overall!.overall_min)} до {number(result.overall!.overall_max)}.</p>
      <h3 className="mt-6 text-lg font-semibold">Результаты по блокам</h3><Statistics rows={blocks} />
      <h3 className="mt-6 text-lg font-semibold">Наибольший разброс</h3><Statistics rows={orderDispersion(blocks,true).slice(0,3)} />
      <h3 className="mt-6 text-lg font-semibold">Наиболее согласованные ответы</h3><Statistics rows={orderDispersion(blocks).slice(0,3)} />
      <details className="mt-6"><summary className="cursor-pointer underline">Разброс по вопросам</summary><p className="mt-3 text-sm text-muted">Значения вопросов — по шкале 0–4 с учётом обратной формулировки. Блоки и индекс — по шкале 0–100. Разброс — стандартное отклонение среди завершивших, без порога «конфликта».</p><h4 className="mt-4 font-semibold">Наибольший разброс</h4><Statistics rows={orderDispersion(questions,true).slice(0,5)} /><h4 className="mt-4 font-semibold">Наиболее согласованные ответы</h4><Statistics rows={orderDispersion(questions).slice(0,5)} /></details>
    </>}
    <p className="mt-6 text-sm text-muted">Для обновления статуса обновите страницу. Индивидуальные ответы и оценки конфиденциальны.</p>
  </Card><Card className="mt-8"><h2 className="text-2xl font-semibold">AI-отчёт команды</h2>
    {!current && <p className="mt-3">{result.reports?.length ? "Предыдущий отчёт устарел: изменился состав завершённых ответов. Можно подготовить новую версию." : "Командный отчёт ещё не подготовлен."}</p>}
    {current && ["queued","generating"].includes(current.status) && <p className="mt-3">Отчёт готовится.</p>}
    {current?.status==="failed" && <p className="mt-3">Не удалось подготовить отчёт. Можно повторить попытку.</p>}
    {result.status==="ready" && (!current || current.status==="failed" || current.status==="superseded") && <TeamResultForm teamId={teamId} intent="report" label={result.reports?.length ? "Обновить AI-отчёт" : "Подготовить AI-отчёт"} />}
    {result.reports?.filter(r=>r.status==="completed").map(r=><details key={r.id} open={r.source_fingerprint===result.fingerprint} className="mt-6"><summary className="cursor-pointer font-semibold">Версия {r.version} · Участников: {r.completed_participant_count}{r.source_fingerprint!==result.fingerprint ? " · Предыдущий состав ответов" : " · Актуальный отчёт"}</summary>{r.structured_content && <article className="mt-4 space-y-4"><p>{r.structured_content.executive_summary}</p><p>{r.structured_content.maturity}</p>{Object.entries(sections).map(([key,title])=><section key={key}><h3 className="font-semibold">{title}</h3><ul className="mt-2 list-disc space-y-1 pl-5">{r.structured_content![key as keyof typeof sections].map((point,i)=><li key={i}>{point}</li>)}</ul></section>)}</article>}</details>)}
  </Card></>;
}
