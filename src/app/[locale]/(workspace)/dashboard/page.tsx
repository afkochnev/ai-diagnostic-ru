import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { requireIdentity } from "@/server/auth/session";
import { getOwnCompany } from "@/server/company/queries";
import { getMessages } from "@/i18n/messages";

export default async function DashboardPage() {
  const identity = await requireIdentity();
  const company = await getOwnCompany(identity.user.id);
  if (!company) redirect("/ru/company-profile");
  const copy = getMessages("ru").company;
  return <main id="main-content" className="min-h-[70vh] py-10 sm:py-14"><Container><div className="mb-8"><p className="text-sm text-muted">{copy.greeting}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{copy.dashboard}</h1></div><div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><Card><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted">{copy.companyData}</p><h2 className="mt-2 text-2xl font-semibold">{company.name}</h2><p className="mt-2 text-muted">{company.country} · {company.employee_count} сотрудников</p></div><Link href="/ru/company-profile?returnTo=/ru/dashboard" className="rounded-xl border border-line px-4 py-3 text-sm font-semibold hover:bg-tint">{copy.edit}</Link></div><dl className="mt-7 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted">Продукты</dt><dd className="mt-1 whitespace-pre-wrap">{company.products}</dd></div><div><dt className="text-muted">Клиенты / клиентские сегменты</dt><dd className="mt-1 whitespace-pre-wrap">{company.customer_segments}</dd></div><div><dt className="text-muted">Каналы продаж</dt><dd className="mt-1 whitespace-pre-wrap">{company.sales_channels}</dd></div><div><dt className="text-muted">Главные цели компании</dt><dd className="mt-1 whitespace-pre-wrap">{company.main_goals}</dd></div></dl></Card><Card><h2 className="text-2xl font-semibold">{copy.diagnostics}</h2><p className="mt-3 text-muted">{copy.emptyDiagnostics}</p><button type="button" disabled className="mt-7 min-h-12 w-full cursor-not-allowed rounded-xl bg-brand/50 px-5 py-3 font-semibold text-white">{copy.newDiagnostic}</button><p className="mt-3 text-xs text-muted">{copy.newDiagnosticUnavailable}</p></Card></div></Container></main>;
}
