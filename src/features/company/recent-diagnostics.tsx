import Link from "next/link";
import { Card } from "@/components/ui/card";

type Individual = {
  diagnostic: { id: string; status: string; started_at?: string; completed_at: string | null; submitted_at?: string | null; last_saved_at?: string | null };
  result: { display_manageability_index: unknown; maturity_label?: string | null } | null;
};
type Team = { id: string; title: string; status: string; created_at: string; completedParticipants: number };
export function recentDiagnostics(individual: Individual[], teams: Team[]) {
  const rows=[
    ...individual.map(item=>({type:"individual" as const,id:item.diagnostic.id,date:item.diagnostic.completed_at ?? item.diagnostic.submitted_at ?? item.diagnostic.started_at ?? item.diagnostic.last_saved_at ?? "",item})),
    ...teams.map(item=>({type:"team" as const,id:item.id,date:item.created_at,item})),
  ];
  const timestamp=(value:string)=>Date.parse(value)||0;
  return rows.sort((a,b)=>timestamp(b.date)-timestamp(a.date)||a.id.localeCompare(b.id)||a.type.localeCompare(b.type)).slice(0,5);
}
export function companyNextAction(companyId:string, activeId:string|undefined, individual:Individual[], teams:Team[]) {
  if(activeId) return {href:`/ru/diagnostics/${activeId}`,label:"Продолжить диагностику",description:"Ваши сохранённые ответы уже на месте. Продолжите с того места, где остановились."};
  const latest=recentDiagnostics(individual,teams)[0];
  if(!latest) return {href:`/ru/companies/${companyId}/diagnostics?new=1`,label:"Начать диагностику",description:"Выберите индивидуальную или командную диагностику."};
  if(latest.type==="team") return {
    href:`/ru/companies/${companyId}/teams/${latest.id}`,
    label:latest.item.completedParticipants>=3?"Открыть командный результат":latest.item.status==="open"?"Посмотреть готовность команды":"Открыть командную диагностику",
    description:latest.item.completedParticipants>=3?"Ответили минимум три участника. Проверьте командные результаты и отчёт.":latest.item.status==="open"?`Завершили: ${latest.item.completedParticipants} из необходимых 3. Проверьте участников и приглашения.`:"Сбор ответов завершён. Для командного результата необходимо минимум три завершивших участника.",
  };
  return {href:`/ru/diagnostics/${latest.id}${latest.item.diagnostic.status==="in_progress"?"":"/result"}`,label:latest.item.diagnostic.status==="in_progress"?"Продолжить диагностику":latest.item.result?"Открыть результаты и отчёт":"Посмотреть статус результата",description:latest.item.result?"Ваши оценки рассчитаны. Откройте анализ и план действий.":"Проверьте готовность результата. Повторно отвечать на вопросы не нужно."};
}
const statuses: Record<string,string>={in_progress:"В процессе",submitted:"Расчёт результатов",scoring:"Расчёт результатов",scoring_failed:"Ошибка расчёта",completed:"Завершена"};
const date=(value:string)=>Number.isNaN(Date.parse(value))?"—":new Date(value).toLocaleDateString("ru-RU");
const badge="rounded-full bg-tint px-3 py-1 text-sm font-semibold";
export function RecentDiagnostics({companyId,individual,teams}:{companyId:string;individual:Individual[];teams:Team[]}) {
  const rows=recentDiagnostics(individual,teams);
  return <section className="mt-8" aria-labelledby="recent-diagnostics-heading">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="recent-diagnostics-heading" className="text-2xl font-semibold">Последние диагностики</h2><Link className="underline" href={`/ru/companies/${companyId}/diagnostics`}>Все диагностики</Link></div>
    {!rows.length ? <Card className="mt-4"><p className="text-muted">Диагностик пока нет.</p></Card> : <div className="mt-4 grid gap-4">{rows.map(row=><Card key={`${row.type}:${row.id}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div>
        <span className={badge}>{row.type==="team"?"Командная":"Индивидуальная"}</span>
        {row.type==="team" ? <><h3 className="mt-3 font-semibold">{row.item.title}</h3><p className="mt-2 text-sm">Завершили: {row.item.completedParticipants} · {row.item.status==="open"?"Сбор ответов открыт":"Сбор завершён"}</p></> : <><p className="mt-3 font-medium">{statuses[row.item.diagnostic.status]??"Обработка"}</p>{row.item.result && <p className="mt-2 text-sm">Индекс управляемости: <strong>{String(row.item.result.display_manageability_index??"—").replace(".",",")}</strong>{row.item.result.maturity_label && <> · {row.item.result.maturity_label}</>}</p>}</>}
        <p className="mt-2 text-sm text-muted">Дата: {date(row.date)}</p>
      </div><Link className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line px-5 py-3 font-semibold hover:bg-tint" href={row.type==="team"?`/ru/companies/${companyId}/teams/${row.id}`:`/ru/diagnostics/${row.id}${row.item.diagnostic.status==="in_progress"?"":"/result"}`}>
        {row.type==="team"?"Открыть командную диагностику":row.item.diagnostic.status==="in_progress"?"Продолжить":"Посмотреть результаты"}
      </Link></div>
    </Card>)}</div>}
  </section>;
}
