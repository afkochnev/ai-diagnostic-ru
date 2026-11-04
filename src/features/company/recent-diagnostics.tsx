import type { Locale } from "@/i18n/config";
import { pilotText as tr } from "@/i18n/pilot-copy";
import Link from "next/link";
import { Card } from "@/components/ui/card";

type Individual = {
  diagnostic: { locale?: string; id: string; status: string; started_at?: string; completed_at: string | null; submitted_at?: string | null; last_saved_at?: string | null };
  result: { display_manageability_index: unknown; maturity_label?: string | null } | null;
};
type Team = { id: string; title: string; status: string; created_at: string; completedParticipants: number };
export function recentDiagnostics(individual: Individual[], teams: Team[]) {
  const rows=[
    ...individual.map(item=>({type:"individual" as const,id:item.diagnostic.id,date:item.diagnostic.completed_at ?? item.diagnostic.submitted_at ?? item.diagnostic.started_at ?? item.diagnostic.last_saved_at ?? "",item})),
    ...teams.map(item=>({type:"team" as const,id:item.id,date:item.created_at,item})),
  ];
  const timestamp=(value:string)=>Date.parse(value)||0;
  return rows.sort((a,b)=>timestamp(b.date)-timestamp(a.date)||a.id.localeCompare(b.id)||a.type.localeCompare(b.type));
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
const date=(value:string,locale:Locale)=>Number.isNaN(Date.parse(value))?"—":new Date(value).toLocaleDateString(locale === "en" ? "en-GB" : "ru-RU");
const badge="rounded-full bg-tint px-3 py-1 text-sm font-semibold";
export function RecentDiagnostics({companyId,individual,teams,locale="ru"}:{companyId:string;individual:Individual[];teams:Team[];locale?:Locale}) {
  const rows=recentDiagnostics(individual,locale === "en" ? [] : teams);
  return <section className="mt-8" aria-labelledby="recent-diagnostics-heading">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="recent-diagnostics-heading" className="text-2xl font-semibold">{tr(locale,"Диагностики")}</h2><Link className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark" href={`/${locale}/companies/${companyId}/diagnostics?new=1`}>{tr(locale,"Новая диагностика")}</Link></div>
    {!rows.length ? <Card className="mt-4"><p className="text-muted">{tr(locale,"Диагностик пока нет.")}</p></Card> : <div className="mt-4 grid gap-4">{rows.map(row=><Card key={`${row.type}:${row.id}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div>
        <span className={badge}>{tr(locale,row.type==="team"?"Командная":"Индивидуальная")}</span>
        {row.type==="team" ? <><h3 className="mt-3 font-semibold">{row.item.title}</h3><p className="mt-2 text-sm">{tr(locale,"Завершили:")} {row.item.completedParticipants} · {tr(locale,row.item.status==="open"?"Сбор ответов открыт":"Сбор завершён")}</p></> : <><p className="mt-3 font-medium">{tr(locale,statuses[row.item.diagnostic.status]??"Обработка")}{locale === "en" && row.item.diagnostic.locale === "ru" && " · Russian"}</p>{row.item.result && <p className="mt-2 text-sm">{tr(locale,"Индекс управляемости:")} <strong>{locale === "en" ? String(row.item.result.display_manageability_index??"—") : String(row.item.result.display_manageability_index??"—").replace(".",",")}</strong>{row.item.result.maturity_label && <> · {row.item.result.maturity_label}</>}</p>}</>}
        <p className="mt-2 text-sm text-muted">{tr(locale,"Дата:")} {date(row.date,locale)}</p>
      </div><Link className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line px-5 py-3 font-semibold hover:bg-tint" href={row.type==="team"?`/${locale}/companies/${companyId}/teams/${row.id}`:`/${row.item.diagnostic.locale === "en" ? "en" : row.item.diagnostic.locale === "ru" ? "ru" : locale}/diagnostics/${row.id}${row.item.diagnostic.status==="in_progress"?"":"/result"}`}>
        {tr(locale,row.type==="team"?"Открыть командную диагностику":row.item.diagnostic.status==="in_progress"?"Продолжить":"Посмотреть результаты")}
      </Link></div>
    </Card>)}</div>}
  </section>;
}
