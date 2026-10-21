import {acquisitionEnabled} from "@/server/acquisition/contracts";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { CompanyNavigation } from "./company-navigation";
import { getActiveDiagnostic, getLatestDiagnostics } from "@/server/diagnostic/service";
import { startDiagnosticAction } from "@/server/diagnostic/actions";
import { hasEntitlement } from "@/server/entitlements";
import { teamFoundationEnabled } from "@/server/team/capabilities";
import { listTeamHistory } from "@/server/team/service";
import { CreateTeamForm } from "@/features/team/owner-forms";
import type { getOwnCompany } from "@/server/company/queries";

type Company = NonNullable<Awaited<ReturnType<typeof getOwnCompany>>>;
const button = "mt-4 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark";
export async function DiagnosticsHub({ company, userId, type }: { company: Company; userId: string; type?: string }) {
  const rollout = teamFoundationEnabled();
  const [active, individual, teams, entitled] = await Promise.all([
    getActiveDiagnostic(userId, company.id), getLatestDiagnostics(userId, company.id),
    rollout ? listTeamHistory(company.id) : Promise.resolve([]),
    hasEntitlement(company.account_id, "team_diagnostics"),
  ]);
  const teamAvailable = rollout && entitled;
  const base = `/ru/companies/${company.id}/diagnostics`;
  const plan = `/ru/account/plan?account=${company.account_id}`;
  const statuses: Record<string, string> = { in_progress: "В процессе", submitted: "Расчёт результатов", scoring: "Расчёт результатов", scoring_failed: "Ошибка расчёта", completed: "Завершена" };
  return <><CompanyNavigation companyId={company.id} userId={userId} /><main id="main-content" className="py-10"><Container>
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-semibold">Диагностики — {company.name}</h1><Link className="underline" href={`${base}?new=1#choose`}>Новая диагностика</Link></div>
    <section id="choose" className="mt-8"><h2 className="text-2xl font-semibold">Какую диагностику вы хотите провести?</h2>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card><h3 className="text-xl font-semibold">Индивидуальная диагностика</h3><p className="mt-3 text-muted">Диагностику проходит один человек. Результат и рекомендации формируются на основе его ответов.</p>
          {active ? <><p className="mt-3">У вас уже есть незавершённая индивидуальная диагностика.</p><Link className={button} href={`/ru/diagnostics/${active.id}`}>Продолжить индивидуальную диагностику</Link></> : <form action={startDiagnosticAction}><input type="hidden" name="company_id" value={company.id} /><button className={button} type="submit">Начать индивидуальную диагностику</button></form>}
        </Card>
        <Card><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-semibold">Командная диагностика</h3><span className="rounded-full bg-tint px-3 py-1 text-sm font-semibold">Advanced</span></div><p className="mt-3 text-muted">Пригласите нескольких участников и получите агрегированный результат, зоны согласия и расхождения и командный AI-отчёт.</p>
          {teamAvailable ? <Link className={button} href={`${base}?new=1&type=team#team-create`}>Создать командную диагностику</Link> : <><p className="mt-4">{rollout ? "Командная диагностика доступна на тарифе Advanced." : "Командная диагностика пока недоступна в этом окружении."}</p><Link className="mt-4 inline-block underline" href={acquisitionEnabled()?`/ru/companies/${company.id}/team-explainer`:plan}>{acquisitionEnabled()?"Проверить диагноз командой":"Подробнее об Advanced"}</Link></>}
        </Card>
      </div>
      {teamAvailable && type === "team" && <Card className="mt-6" id="team-create"><h3 className="mb-4 text-xl font-semibold">Новая командная диагностика</h3><p className="mb-4 text-muted">Вы не становитесь участником автоматически. Организатор видит статусы прохождения, без индивидуальных ответов.</p><CreateTeamForm key={company.id} companyId={company.id} defaultTitle={`Командная диагностика ${company.name}`} /></Card>}
    </section>
    <section className="mt-10"><h2 className="text-2xl font-semibold">Индивидуальные диагностики</h2><div className="mt-5 space-y-4">{individual.length ? individual.map(({ diagnostic, result }) => <Card key={diagnostic.id}><p className="text-sm font-semibold">Индивидуальная</p><p className="mt-2">{statuses[diagnostic.status] ?? "Обработка"}</p>{diagnostic.completed_at && <p className="mt-2 text-sm text-muted">{new Date(diagnostic.completed_at).toLocaleDateString("ru-RU")}</p>}{result && <p className="mt-2">Индекс управляемости: {String(result.display_manageability_index ?? "—").replace(".", ",")}</p>}<Link className="mt-3 inline-block underline" href={`/ru/diagnostics/${diagnostic.id}${diagnostic.status === "in_progress" ? "" : "/result"}`}>{diagnostic.status === "in_progress" ? "Продолжить" : "Открыть результат"}</Link></Card>) : <p className="text-muted">Индивидуальных диагностик пока нет.</p>}</div></section>
    {rollout && <section id="teams" className="mt-10"><h2 className="text-2xl font-semibold">Командные диагностики</h2><div className="mt-5 space-y-4">{teams.length ? teams.map(team => <Card key={team.id}><p className="text-sm font-semibold">Командная</p><Link className="mt-2 inline-block text-xl font-semibold underline" href={`/ru/companies/${company.id}/teams/${team.id}`}>{team.title}</Link><p className="mt-2">{team.completedParticipants} участника завершили · {team.status === "open" ? "Сбор ответов открыт" : "Сбор завершён"}</p><p className="mt-2 text-sm text-muted">{new Date(team.created_at).toLocaleDateString("ru-RU")}</p></Card>) : <p className="text-muted">Командных диагностик пока нет.</p>}</div></section>}
  </Container></main></>;
}
