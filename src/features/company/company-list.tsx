import { getAccountPlan } from "@/server/entitlements";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { getCurrentAccount } from "@/server/account/current";
import { canCreateAdditionalCompany } from "@/server/company/capabilities";
import { getReferenceData, listAccessibleCompanies } from "@/server/company/queries";
import { AddCompanyLock } from "./add-company-lock";

export async function CompanyList({ userId, accountId }: { userId: string; accountId?: string }) {
  const context = await getCurrentAccount(userId, accountId);
  if (context.kind === "denied") redirect("/ru/access-denied");
  if (context.kind !== "selected") return <main id="main-content" className="min-h-[70vh] py-10 sm:py-14"><Container>
    <h1 className="text-3xl font-semibold tracking-tight">Компании</h1>
    {context.kind === "missing" ? <p className="mt-6 text-muted">Нет доступной рабочей области. Обратитесь в поддержку.</p> : <><p className="mt-6 text-muted">Выберите рабочую область, чтобы открыть её компании и диагностики.</p><ul className="mt-6 grid gap-4 sm:grid-cols-2">{context.accounts.map(account => <li key={account.id}><Card><h2 className="text-xl font-semibold">{account.name}</h2><Link href={`/ru/accounts/${account.id}/companies`} className="mt-4 inline-flex min-h-12 items-center rounded-xl border border-line px-5 py-3 font-semibold hover:bg-tint">Открыть компании</Link></Card></li>)}</ul></>}
  </Container></main>;
  const { account } = context;
  const [plan, scopedCompanies, references] = await Promise.all([getAccountPlan(account.id), listAccessibleCompanies(userId, account.id), getReferenceData()]);
  const companies = scopedCompanies.filter(company => company.account_id === account.id);
  const industries = new Map(references.industries.map(item => [item.industry_key, item.name]));
  const planUrl = `/ru/account/plan?account=${account.id}`;
  const createUrl = companies.length ? `/ru/companies/new?from=${companies[0].id}` : `/ru/companies/new?account=${account.id}`;
  const button = "inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark";
  return <main id="main-content" className="min-h-[70vh] py-10 sm:py-14"><Container>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-semibold tracking-tight">Компании</h1><Link className="inline-flex min-h-11 items-center text-sm underline" href={planUrl}>Тариф {plan.display_name}</Link></div>
    <p className="mt-3 text-muted">Выберите компанию, чтобы открыть её профиль и диагностики.</p>
    {companies.length === 0 ? <Card className="mt-8"><p className="text-muted">Добавьте вашу компанию, чтобы начать диагностику.</p><Link href={createUrl} className={`mt-4 ${button}`}>Добавить вашу компанию</Link></Card> : <>
      <div className="mt-8 grid min-w-0 gap-4 sm:grid-cols-2">{companies.map(company => {
        const details = [company.industry_key ? industries.get(company.industry_key) ?? company.industry_key : null, company.country, company.employee_count == null ? null : `${company.employee_count} сотрудников`].filter(Boolean);
        return <Card key={company.id} className="min-w-0"><h2 className="break-words text-xl font-semibold">{company.name}</h2>{details.length > 0 && <p className="mt-2 break-words text-sm text-muted">{details.join(" · ")}</p>}<Link href={`/ru/companies/${company.id}`} className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl border border-line px-5 py-3 font-semibold hover:bg-tint">Открыть компанию</Link></Card>;
      })}</div>
      {canCreateAdditionalCompany(account) && <div className="mt-6 flex justify-end">{plan.entitlements.multi_company ? <Link href={createUrl} className={button}>Добавить компанию</Link> : <AddCompanyLock planUrl={planUrl} />}</div>}
    </>}
  </Container></main>;
}
