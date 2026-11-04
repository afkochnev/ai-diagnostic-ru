import { pilotText as tr } from "@/i18n/pilot-copy";
import { requestLocale } from "@/server/locale";
import Link from "next/link";
import { requireCompanyRead } from "@/server/account/authorization";
import { listAccessibleCompanies } from "@/server/company/queries";

export async function CompanyNavigation({ companyId, userId }: { companyId: string; userId: string }) {
  const locale = await requestLocale();

  const company = await requireCompanyRead(companyId, userId);
  const companies = await listAccessibleCompanies(userId, company.account_id);
  return <nav aria-label={tr(locale, "Навигация компании")} className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-5 py-5 text-sm sm:px-8">
    <Link href={`/${locale}/accounts/${company.account_id}/companies`} className="underline">{tr(locale, "Компании")}</Link>
    {companies.length > 1 ? <details className="relative">
      <summary className="cursor-pointer rounded-xl border border-line px-4 py-3 font-semibold">{company.name}</summary>
      <ul aria-label={tr(locale, "Переключить компанию")} className="absolute left-0 z-20 mt-2 min-w-64 rounded-xl border border-line bg-white p-2 shadow-card">
        {companies.map((item) => <li key={item.id}><Link aria-current={item.id === company.id ? "page" : undefined} className="block rounded-lg px-3 py-3 hover:bg-tint" href={`/${locale}/companies/${item.id}`}>{item.name}</Link></li>)}
      </ul>
    </details> : <span className="font-semibold">{company.name}</span>}
    <Link href={`/${locale}/companies/${company.id}/profile`} className="underline">{tr(locale, "Профиль")}</Link>
    <Link href={`/${locale}/companies/${company.id}/diagnostics`} className="underline">{tr(locale, "Диагностики")}</Link>
    {locale === "ru" && <Link href={`/${locale}/account/plan?account=${company.account_id}`} className="underline">{tr(locale, "Тариф")}</Link>}
  </nav>;
}
