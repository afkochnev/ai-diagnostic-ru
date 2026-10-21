import {annualOffer,receiptSettings} from '@/server/billing/commercial';
import {annualAccess} from '@/server/billing/service';
import {yookassaConfigured} from '@/server/billing/yookassa';
import {requireCompanyRead} from '@/server/account/authorization';
import {billingConfig} from '@/server/billing/contracts';
import {startCheckout} from '@/server/billing/actions';
import {acquisitionEnabled} from "@/server/acquisition/contracts";
import {conversionContinuation} from "@/server/acquisition/service";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/server/auth/session";
import { listAccessibleAccounts } from "@/server/account/queries";
import { getAccountPlan } from "@/server/entitlements";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";

export default async function AccountPlanPage({ searchParams }: { searchParams: Promise<{ account?: string; company?: string; billingError?: string }> }) {
  const identity = await requireIdentity();
  const accounts = await listAccessibleAccounts(identity.user.id);
  const { account: requested, company: requestedCompany, billingError } = await searchParams;
  const account = requested ? accounts.find(a => a.id === requested) : accounts.length === 1 ? accounts[0] : null;
  if (requested && !account) redirect("/ru/access-denied");
  if (!account) return <main id="main-content" className="py-10"><Container><h1 className="text-3xl font-semibold">Выберите аккаунт</h1><ul className="mt-6 space-y-4">{accounts.map(a => <li key={a.id}><Link className="underline" href={`/ru/account/plan?account=${a.id}`}>{a.name}</Link></li>)}</ul><Link className="mt-6 inline-block underline" href="/ru/companies">Компании</Link></Container></main>;
  const plan = await getAccountPlan(account.id);
  const intentCompany=acquisitionEnabled()?await conversionContinuation(account.id):null;
  // Older diagnostics have no V2.5 acquisition intent. An explicit Company is
  // only context, never authority: resolve ownership and Account again here.
  let explicitCompany=null;
  if(requestedCompany){
    try{explicitCompany=await requireCompanyRead(requestedCompany,identity.user.id);}catch{redirect('/ru/access-denied');}
    if(explicitCompany.account_id!==account.id||(intentCompany&&intentCompany!==explicitCompany.id))redirect('/ru/access-denied');
  }
  const continuation=intentCompany??explicitCompany?.id??null;
  const company=explicitCompany??(continuation?await requireCompanyRead(continuation,identity.user.id):null);
  const billing=billingConfig(),annual=billing.provider==='yookassa';
  const access=annual?await annualAccess(account.id):null;
  let checkoutReady=billing.enabled;
  if(annual){try{receiptSettings(process.env);checkoutReady=checkoutReady&&yookassaConfigured();}catch{checkoutReady=false;}}
  return <main id="main-content" className="py-10"><Container><Link className="underline" href={`/ru/accounts/${account.id}/companies`}>Компании</Link><h1 className="mt-6 text-3xl font-semibold">Тариф аккаунта</h1><p className="mt-3 text-muted">{account.name}</p><p className="mt-4 text-xl">Текущий тариф: <strong>{plan.display_name}</strong></p><div className="mt-8 grid gap-6 md:grid-cols-2"><Card><h2 className="text-2xl font-semibold">Free</h2><ul className="mt-4 list-disc space-y-2 pl-5"><li>1 компания</li><li>Индивидуальные диагностики и история</li><li>Индивидуальные AI-отчёты и PDF</li><li>Заявки на консультацию и обратная связь</li></ul></Card><Card><h2 className="text-2xl font-semibold">Advanced</h2><p className="mt-3">Всё, что входит в Free, а также:</p><ul className="mt-4 list-disc space-y-2 pl-5"><li>Несколько компаний</li><li>Командные диагностики и участники</li><li>Агрегированные результаты и командные AI-отчёты</li><li>Командные PDF</li></ul></Card></div>{(plan.plan==='free'||access?.renewable)&&<Card><h2 className="text-2xl font-semibold">{access?.renewable?'Продлить Advanced на год':'Подключить Advanced'}</h2>{annual&&<><p className="mt-4 text-xl">{annualOffer.display.price}</p><p className="mt-2">Без НДС. Доступ на 1 год, без автоматического продления.</p>{access?.effective_until&&<p>Оплачено до {new Date(access.effective_until).toLocaleDateString('ru-RU',{timeZone:'UTC'})}. При продлении оставшееся оплаченное время сохраняется.</p>}</>}{company&&<p className="mt-3">Компания: {company.name}</p>}{checkoutReady?<><p className="mt-4 font-semibold">Тестовый режим оплаты</p><p className="mt-3">Тестовая оплата — реальные деньги не списываются.</p><p className="mt-3">После подключения вы сможете создать командную диагностику{continuation?' для выбранной компании':''}.</p><form action={startCheckout} className="mt-5"><input type="hidden" name="account" value={account.id}/>{continuation&&<input type="hidden" name="company" value={continuation}/>}<button className="rounded-xl bg-brand px-5 py-3 text-white">{annual?`Подключить Advanced за ${annualOffer.display.price}`:'Перейти к тестовой оплате'}</button></form></>:<p className="mt-4">{annual?'Оплата временно недоступна. Ваши диагностики и отчёты доступны.':'Стоимость и условия оплаты пока не настроены.'}</p>}{billingError&&<p className="mt-4" role="alert">Не удалось открыть оплату. Попробуйте позже. Ваши диагностики и отчёты доступны.</p>}</Card>}{continuation&&<Link className="mt-6 inline-block underline" href={plan.entitlements.team_diagnostics?`/ru/companies/${continuation}/diagnostics?new=1&type=team#team-create`:`/ru/companies/${continuation}/team-explainer`}>{plan.entitlements.team_diagnostics?"Создать командную диагностику":"Вернуться к командной диагностике"}</Link>}</Container></main>;
}
