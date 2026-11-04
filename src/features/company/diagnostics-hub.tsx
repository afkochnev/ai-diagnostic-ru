import { pilotText as tr } from "@/i18n/pilot-copy";
import { requestLocale } from "@/server/locale";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { CompanyNavigation } from "./company-navigation";
import { getActiveDiagnostic, getLatestDiagnostics } from "@/server/diagnostic/service";
import { startDiagnosticAction } from "@/server/diagnostic/actions";
import { hasEntitlement } from "@/server/entitlements";
import { teamFoundationEnabled, teamCreationEnabled } from "@/server/team/capabilities";
import { listTeamHistory } from "@/server/team/service";
import { CreateTeamForm } from "@/features/team/owner-forms";
import type { getOwnCompany } from "@/server/company/queries";

type Company = NonNullable<Awaited<ReturnType<typeof getOwnCompany>>>;
const button = "mt-4 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark";
export async function DiagnosticsHub({ company, userId, type, existingLanguage, existingDiagnostic }: { company: Company; userId: string; type?: string; existingLanguage?: string; existingDiagnostic?: string }) {
  const locale = await requestLocale();

  const rollout = teamFoundationEnabled();
  const [active, individual, teams, entitled] = await Promise.all([
    getActiveDiagnostic(userId, company.id), getLatestDiagnostics(userId, company.id),
    rollout ? listTeamHistory(company.id) : Promise.resolve([]),
    hasEntitlement(company.account_id, "team_diagnostics"),
  ]);
  const teamAvailable = rollout && teamCreationEnabled() && entitled;
  const base = `/${locale}/companies/${company.id}/diagnostics`;
  const plan = `/${locale}/account/plan?account=${company.account_id}&company=${company.id}`;
  const teamEntry = `${base}?new=1&type=team#team-create`;
  const statuses: Record<string, string> = { in_progress: tr(locale, "В процессе"), submitted: tr(locale, "Расчёт результатов"), scoring: tr(locale, "Расчёт результатов"), scoring_failed: tr(locale, "Ошибка расчёта"), completed: tr(locale, "Завершена") };
  const activeInRussian = locale === "en" && active && active.locale !== "en";
  const conflictingRussianDraft = activeInRussian ? active.id : existingLanguage === "ru" && existingDiagnostic ? existingDiagnostic : null;
  if (locale === "en") return <><CompanyNavigation companyId={company.id} userId={userId} /><main id="main-content" className="py-10"><Container><h1 className="text-3xl font-semibold">Individual assessment — {company.name}</h1><Card className="mt-7"><h2 className="text-xl font-semibold">Explore the company’s management</h2><p className="mt-3 text-muted">Allow about 20 minutes. Your answers are saved automatically. You will receive your scores, an English AI report and a PDF.</p>{conflictingRussianDraft ? <><p role="status" className="mt-4 rounded-xl bg-tint p-4 text-sm">This company has a Russian assessment in progress. Its original language and saved answers are preserved. Complete it before starting a new English assessment, or use a separate demo company if your access allows it.</p><Link className={button} href={`/ru/diagnostics/${conflictingRussianDraft}`}>Continue the existing Russian assessment</Link></> : active ? <Link className={button} href={`/en/diagnostics/${active.id}`}>Continue your assessment</Link> : <form action={startDiagnosticAction}><input type="hidden" name="locale" value="en" /><input type="hidden" name="company_id" value={company.id} /><button className={button}>Start an individual assessment</button></form>}</Card><section className="mt-8"><h2 className="text-2xl font-semibold">Your assessments</h2><div className="mt-4 space-y-4">{individual.length ? individual.map(({diagnostic, result}) => <Card key={diagnostic.id}><p>{tr(locale, statuses[diagnostic.status] ?? "Обработка")}{diagnostic.locale !== "en" && " · Russian"}</p>{result && <p className="mt-2">Management health index: {String(result.display_manageability_index ?? "—")}</p>}<Link className="mt-3 inline-block underline" href={`/${diagnostic.locale === "en" ? "en" : "ru"}/diagnostics/${diagnostic.id}${diagnostic.status === "in_progress" ? "" : "/result"}`}>{diagnostic.status === "in_progress" ? "Continue" : "View results"}</Link></Card>) : <p>No assessments yet.</p>}</div></section></Container></main></>;
  return <><CompanyNavigation companyId={company.id} userId={userId} /><main id="main-content" className="py-10"><Container>
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-semibold">Диагностики — {company.name}</h1><Link className="underline" href={`${base}?new=1#choose`}>{tr(locale, "Новая диагностика")}</Link></div>
    <section id="choose" className="mt-8"><h2 className="text-2xl font-semibold">Какую диагностику вы хотите провести?</h2>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card><h3 className="text-xl font-semibold">{tr(locale, "Индивидуальная диагностика")}</h3><p className="mt-3 text-muted">{tr(locale, "Диагностику проходит один человек. Результат и рекомендации формируются на основе его ответов.")}</p>
          {active ? <><p className="mt-3">{tr(locale, "У вас уже есть незавершённая индивидуальная диагностика.")}</p><Link className={button} href={`/${locale}/diagnostics/${active.id}`}>{tr(locale, "Продолжить индивидуальную диагностику")}</Link></> : <form action={startDiagnosticAction}><input type="hidden" name="locale" value={locale} /><input type="hidden" name="company_id" value={company.id} /><button className={button} type="submit">{tr(locale, "Начать индивидуальную диагностику")}</button></form>}
        </Card>
        <Card><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-semibold">Командная диагностика</h3><span className="rounded-full bg-tint px-3 py-1 text-sm font-semibold">Advanced</span></div><p className="mt-3 text-muted">Пригласите нескольких участников и получите агрегированный результат, зоны согласия и расхождения и командный AI-отчёт.</p>
          <Link className={button} href={entitled?teamEntry:plan}>Начать командную диагностику</Link>
          {!entitled ? <p className="mt-3 text-sm text-muted">Командная диагностика входит в Advanced. Подключите доступ или используйте промокод на следующем шаге.</p> : !teamAvailable && <p className="mt-3 text-sm text-muted">Создание новых командных диагностик временно приостановлено. Ваши сохранённые диагностики и отчёты доступны.</p>}
        </Card>
      </div>
      {type === "team" && <Card className="mt-6" id="team-create"><h3 className="mb-4 text-xl font-semibold">Новая командная диагностика</h3>{teamAvailable ? <><p className="mb-4 text-muted">Вы организуете диагностику: формируете список участников, приглашаете их и отслеживаете прохождение. Индивидуальные ответы участников вам недоступны. Вы получите общий результат команды. Чтобы заполнить анкету самостоятельно, добавьте себя в список участников.</p><CreateTeamForm key={company.id} companyId={company.id} defaultTitle={`Командная диагностика ${company.name}`} /></> : entitled ? <><p role="status" className="text-muted">Создание новых командных диагностик временно приостановлено. Ваши сохранённые диагностики и отчёты доступны.</p><p className="mt-3 text-sm text-muted">Если вам нужна помощь, напишите на <a className="underline" href="mailto:alexander@iteamsystems.com">alexander@iteamsystems.com</a>.</p></> : <><p className="text-muted">Командная диагностика доступна на тарифе Advanced.</p><Link className={button} href={plan}>Подключить Advanced или применить промокод</Link></>}</Card>}
    </section>
    <section className="mt-10"><h2 className="text-2xl font-semibold">{tr(locale, "Индивидуальные диагностики")}</h2><div className="mt-5 space-y-4">{individual.length ? individual.map(({ diagnostic, result }) => <Card key={diagnostic.id}><p className="text-sm font-semibold">{tr(locale, "Индивидуальная")}</p><p className="mt-2">{statuses[diagnostic.status] ?? tr(locale, "Обработка")}</p>{diagnostic.completed_at && <p className="mt-2 text-sm text-muted">{new Date(diagnostic.completed_at).toLocaleDateString("ru-RU")}</p>}{result && <p className="mt-2">{tr(locale, "Индекс управляемости:")} {String(result.display_manageability_index ?? "—").replace(".", ",")}</p>}<Link className="mt-3 inline-block underline" href={`/${locale}/diagnostics/${diagnostic.id}${diagnostic.status === "in_progress" ? "" : "/result"}`}>{diagnostic.status === "in_progress" ? tr(locale, "Продолжить") : tr(locale, "Открыть результат")}</Link></Card>) : <p className="text-muted">{tr(locale, "Индивидуальных диагностик пока нет.")}</p>}</div></section>
    {rollout && <section id="teams" className="mt-10"><h2 className="text-2xl font-semibold">Командные диагностики</h2><div className="mt-5 space-y-4">{teams.length ? teams.map(team => <Card key={team.id}><p className="text-sm font-semibold">{tr(locale, "Командная")}</p><Link className="mt-2 inline-block text-xl font-semibold underline" href={`/${locale}/companies/${company.id}/teams/${team.id}`}>{team.title}</Link><p className="mt-2">{team.completedParticipants} участника завершили · {team.status === "open" ? tr(locale, "Сбор ответов открыт") : tr(locale, "Сбор завершён")}</p><p className="mt-2 text-sm text-muted">{new Date(team.created_at).toLocaleDateString("ru-RU")}</p></Card>) : <p className="text-muted">Командных диагностик пока нет.</p>}</div></section>}
  </Container></main></>;
}
