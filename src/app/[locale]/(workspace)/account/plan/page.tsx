import {acquisitionEnabled} from "@/server/acquisition/contracts";
import {conversionContinuation} from "@/server/acquisition/service";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/server/auth/session";
import { listAccessibleAccounts } from "@/server/account/queries";
import { getAccountPlan } from "@/server/entitlements";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";

export default async function AccountPlanPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const identity = await requireIdentity();
  const accounts = await listAccessibleAccounts(identity.user.id);
  const { account: requested } = await searchParams;
  const account = requested ? accounts.find(a => a.id === requested) : accounts.length === 1 ? accounts[0] : null;
  if (requested && !account) redirect("/ru/access-denied");
  if (!account) return <main id="main-content" className="py-10"><Container><h1 className="text-3xl font-semibold">Выберите аккаунт</h1><ul className="mt-6 space-y-4">{accounts.map(a => <li key={a.id}><Link className="underline" href={`/ru/account/plan?account=${a.id}`}>{a.name}</Link></li>)}</ul><Link className="mt-6 inline-block underline" href="/ru/companies">Компании</Link></Container></main>;
  const plan = await getAccountPlan(account.id);
  const continuation=acquisitionEnabled()?await conversionContinuation(account.id):null;
  return <main id="main-content" className="py-10"><Container><Link className="underline" href={`/ru/accounts/${account.id}/companies`}>Компании</Link><h1 className="mt-6 text-3xl font-semibold">Тариф аккаунта</h1><p className="mt-3 text-muted">{account.name}</p><p className="mt-4 text-xl">Текущий тариф: <strong>{plan.display_name}</strong></p><div className="mt-8 grid gap-6 md:grid-cols-2"><Card><h2 className="text-2xl font-semibold">Free</h2><ul className="mt-4 list-disc space-y-2 pl-5"><li>1 компания</li><li>Индивидуальные диагностики и история</li><li>Индивидуальные AI-отчёты и PDF</li><li>Заявки на консультацию и обратная связь</li></ul></Card><Card><h2 className="text-2xl font-semibold">Advanced</h2><p className="mt-3">Всё, что входит в Free, а также:</p><ul className="mt-4 list-disc space-y-2 pl-5"><li>Несколько компаний</li><li>Командные диагностики и участники</li><li>Агрегированные результаты и командные AI-отчёты</li></ul></Card></div><p className="mt-6 text-muted">Оплата будет подключена на следующем этапе.</p>{continuation&&<Link className="mt-6 inline-block underline" href={plan.entitlements.team_diagnostics?`/ru/companies/${continuation}/diagnostics?new=1&type=team#team-create`:`/ru/companies/${continuation}/team-explainer`}>{plan.entitlements.team_diagnostics?"Создать командную диагностику":"Вернуться к командной диагностике"}</Link>}</Container></main>;
}
