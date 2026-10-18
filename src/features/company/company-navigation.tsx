import Link from "next/link";
import { requireCompanyRead } from "@/server/account/authorization";
import { listAccessibleCompanies } from "@/server/company/queries";

export async function CompanyNavigation({ companyId, userId }: { companyId: string; userId: string }) {
  const company = await requireCompanyRead(companyId, userId);
  const companies = await listAccessibleCompanies(userId, company.account_id);
  return <nav aria-label="Навигация компании" className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-5 py-5 text-sm sm:px-8">
    <Link href="/ru/companies" className="underline">Компании</Link>
    {companies.length > 1 ? <details className="relative">
      <summary className="cursor-pointer rounded-xl border border-line px-4 py-3 font-semibold">{company.name}</summary>
      <ul aria-label="Переключить компанию" className="absolute left-0 z-20 mt-2 min-w-64 rounded-xl border border-line bg-white p-2 shadow-card">
        {companies.map((item) => <li key={item.id}><Link aria-current={item.id === company.id ? "page" : undefined} className="block rounded-lg px-3 py-3 hover:bg-tint" href={`/ru/companies/${item.id}`}>{item.name}</Link></li>)}
      </ul>
    </details> : <span className="font-semibold">{company.name}</span>}
    <Link href={`/ru/companies/${company.id}/profile`} className="underline">Профиль</Link>
    <Link href={`/ru/companies/${company.id}/diagnostics`} className="underline">Диагностики</Link>
    <Link href={`/ru/account/plan?account=${company.account_id}`} className="underline">Тариф</Link>
  </nav>;
}
