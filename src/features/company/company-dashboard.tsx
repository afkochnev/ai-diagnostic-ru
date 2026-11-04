import { pilotText as tr } from "@/i18n/pilot-copy";
import { requestLocale } from "@/server/locale";
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
  const locale = await requestLocale();

  const [activeDiagnostic,diagnostics,teams]=await Promise.all([
    getActiveDiagnostic(userId,company.id),getLatestDiagnostics(userId,company.id),
    locale === "ru" && teamFoundationEnabled()?listTeamHistory(company.id):Promise.resolve([]),
  ]);
  const copy = getMessages(locale).company;
  const individual = activeDiagnostic && !diagnostics.some(({ diagnostic }) => diagnostic.id === activeDiagnostic.id)
    ? [{ diagnostic: { ...activeDiagnostic, completed_at: null }, result: null }, ...diagnostics]
    : diagnostics;
  return <><CompanyNavigation companyId={company.id} userId={userId} /><main id="main-content" className="min-h-[70vh] py-10 sm:py-14"><Container>
    <header className="mb-8"><h1 className="break-words text-3xl font-semibold tracking-tight">{company.name}</h1><p className="mt-2 text-muted">{tr(locale, "Диагностика системы управления")}</p></header>
    <Card><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">{copy.companyData}</h2><p className="mt-2 text-sm text-muted">{company.country??tr(locale, "Страна не указана")} · {company.employee_count} {tr(locale, "сотрудников")}</p></div><Link href={`/${locale}/companies/${company.id}/profile`} className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 py-3 text-sm font-semibold hover:bg-tint">{copy.edit}</Link></div><details className="mt-4"><summary className="cursor-pointer text-sm underline">{tr(locale, "Сведения о компании")}</summary><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted">{tr(locale, "Продукты")}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{company.products}</dd></div><div><dt className="text-muted">{tr(locale, "Клиенты / клиентские сегменты")}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{company.customer_segments}</dd></div><div><dt className="text-muted">{tr(locale, "Каналы продаж")}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{company.sales_channels}</dd></div><div><dt className="text-muted">{tr(locale, "Главные цели компании")}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{company.main_goals}</dd></div></dl></details></Card>
    <RecentDiagnostics companyId={company.id} individual={individual} teams={teams} locale={locale} />
  </Container></main></>;
}
