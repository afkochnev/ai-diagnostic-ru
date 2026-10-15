import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { listAccessibleAccounts } from "@/server/account/queries";
import { canCreateAdditionalCompany } from "@/server/company/capabilities";
import { getReferenceData, listAccessibleCompanies } from "@/server/company/queries";

export async function CompanyList({ userId, accountId }: { userId: string; accountId?: string }) {
  const [allAccounts, allCompanies, references] = await Promise.all([listAccessibleAccounts(userId), listAccessibleCompanies(userId), getReferenceData()]);
  const industries = new Map(references.industries.map((item) => [item.industry_key, item.name]));
  const accounts = accountId === undefined ? allAccounts : allAccounts.filter(({ id }) => id === accountId);
  if (accountId !== undefined && accounts.length === 0) redirect("/ru/access-denied");
  return <main id="main-content" className="min-h-[70vh] py-10 sm:py-14"><Container>
    <h1 className="text-3xl font-semibold tracking-tight">Компании</h1>
    <p className="mt-3 text-muted">Выберите компанию, чтобы открыть её профиль и диагностики.</p>
    <div className="mt-8 grid gap-6">{accounts.map((account) => {
      const companies = allCompanies.filter(({ account_id }) => account_id === account.id);
      return <section key={account.id}><div className="mb-4 flex flex-wrap items-center justify-between gap-4"><h2 className="text-xl font-semibold">{account.name}</h2>{companies.length > 0 && canCreateAdditionalCompany(account) && <Link href={`/ru/companies/new?from=${companies[0].id}`} className="rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark">Добавить компанию</Link>}</div>
        {companies.length === 0 ? <Card><p className="text-muted">Добавьте вашу компанию, чтобы начать диагностику.</p><Link href="/ru/companies/new" className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark">Добавить вашу компанию</Link></Card> : <div className="grid gap-4 sm:grid-cols-2">{companies.map((company) => <Card key={company.id}><h3 className="text-xl font-semibold">{company.name}</h3><p className="mt-2 text-sm text-muted">{industries.get(company.industry_key) ?? company.industry_key} · {company.country} · {company.employee_count} сотрудников</p><Link href={`/ru/companies/${company.id}`} className="mt-4 inline-flex min-h-12 items-center rounded-xl border border-line px-5 py-3 font-semibold hover:bg-tint">Открыть компанию</Link></Card>)}</div>}
      </section>;
    })}{accounts.length === 0 && <Card><p className="text-muted">Нет доступных аккаунтов. Обратитесь в поддержку.</p></Card>}</div>
  </Container></main>;
}
