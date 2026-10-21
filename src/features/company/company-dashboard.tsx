import {acquisitionEnabled} from "@/server/acquisition/contracts";
import {CompanyValueMoment} from "@/features/acquisition/company-value-moment";
import { RecentDiagnostics } from "./recent-diagnostics";
import { listTeamHistory } from "@/server/team/service";
import { teamFoundationEnabled } from "@/server/team/capabilities";
import { CompanyNavigation } from "./company-navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import type { getOwnCompany } from "@/server/company/queries";
import { getActiveDiagnostic, getLatestDiagnostics } from "@/server/diagnostic/service";
import { getMessages } from "@/i18n/messages";

type Company = NonNullable<Awaited<ReturnType<typeof getOwnCompany>>>;

export async function CompanyDashboard({ company, userId }: { company: Company; userId: string }) {
  const [activeDiagnostic,diagnostics,teams]=await Promise.all([
    getActiveDiagnostic(userId,company.id),getLatestDiagnostics(userId,company.id),
    teamFoundationEnabled()?listTeamHistory(company.id):Promise.resolve([]),
  ]);
  const copy = getMessages("ru").company;
  const valueMoment=acquisitionEnabled()?await CompanyValueMoment({company,diagnostics}):null;
  return <><CompanyNavigation companyId={company.id} userId={userId} /><main id="main-content" className="min-h-[70vh] py-10 sm:py-14"><Container><div className="mb-8"><Link href={`/ru/accounts/${company.account_id}/companies`} className="mb-4 inline-block text-sm underline">Компании</Link><p className="text-sm text-muted">{copy.greeting}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{copy.dashboard}</h1></div><div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><Card><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted">{copy.companyData}</p><h2 className="mt-2 text-2xl font-semibold">{company.name}</h2><p className="mt-2 text-muted">{company.country??"Страна не указана"} · {company.employee_count} сотрудников</p></div><Link href={`/ru/companies/${company.id}/profile`} className="rounded-xl border border-line px-4 py-3 text-sm font-semibold hover:bg-tint">{copy.edit}</Link></div><dl className="mt-7 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted">Продукты</dt><dd className="mt-1 whitespace-pre-wrap">{company.products}</dd></div><div><dt className="text-muted">Клиенты / клиентские сегменты</dt><dd className="mt-1 whitespace-pre-wrap">{company.customer_segments}</dd></div><div><dt className="text-muted">Каналы продаж</dt><dd className="mt-1 whitespace-pre-wrap">{company.sales_channels}</dd></div><div><dt className="text-muted">Главные цели компании</dt><dd className="mt-1 whitespace-pre-wrap">{company.main_goals}</dd></div></dl></Card><Card><h2 className="text-2xl font-semibold">{copy.diagnostics}</h2>{activeDiagnostic && <Link href={`/ru/diagnostics/${activeDiagnostic.id}`} className="mt-5 inline-flex min-h-12 items-center rounded-xl border border-line px-5 py-3 font-semibold">Продолжить индивидуальную диагностику</Link>}<Link href={`/ru/companies/${company.id}/diagnostics?new=1`} className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark">Начать диагностику</Link><p className="mt-3 text-sm text-muted">Выберите индивидуальную или командную диагностику.</p></Card></div>{valueMoment}<RecentDiagnostics companyId={company.id} individual={diagnostics} teams={teams} /></Container></main></>;
}
