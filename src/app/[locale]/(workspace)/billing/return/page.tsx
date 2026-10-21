import Link from 'next/link';
import {requireIdentity} from '@/server/auth/session';
import {readCheckout} from '@/server/billing/service';
import {teamContinuation} from '@/server/billing/contracts';
import {BillingPending} from '@/features/billing/pending';
import {Container} from '@/components/ui/container';
import {Card} from '@/components/ui/card';
export default async function Page({searchParams}:{searchParams:Promise<{checkout?:string}>}){
 await requireIdentity();const {checkout}=await searchParams;
 let c;try{c=await readCheckout(checkout??'',true);}catch{return <main id="main-content" className="py-10"><Container><h1 className="text-3xl font-semibold">Оплата не подтверждена</h1><p className="mt-4">Сведения об оплате недоступны для этого аккаунта.</p><Link className="mt-4 inline-block underline" href="/ru/companies">Компании</Link></Container></main>;}
 const paid=c.status==='succeeded'&&c.plan==='advanced',pending=['created','pending'].includes(c.status),next=teamContinuation(c.company_id);
 return <main id="main-content" className="py-10"><Container><Card>{c.test_mode&&<p>Тестовый режим оплаты</p>}<h1 className="mt-4 text-3xl font-semibold">{paid?'Advanced подключён':pending?'Проверяем оплату':c.status==='cancelled'?'Оплата отменена':'Оплата не подтверждена'}</h1><p className="mt-4">Аккаунт: {c.account_name}{c.company_name?` · Компания: ${c.company_name}`:''}</p>{pending?<BillingPending checkout={c.id}/>:paid?<><p className="mt-4">Оплата подтверждена. Командная диагностика доступна.</p><Link className="mt-6 inline-block rounded-xl bg-brand px-5 py-3 text-white" href={next??`/ru/accounts/${c.account_id}/companies`}>{next?'Создать командную диагностику':'Выбрать компанию'}</Link></>:<><p className="mt-4">Индивидуальная диагностика и её отчёт доступны в кабинете.</p><Link className="mt-5 inline-block underline" href={`/ru/account/plan?account=${c.account_id}`}>Вернуться к Advanced и попробовать ещё раз</Link>{c.company_id&&<p className="mt-4"><Link className="underline" href={`/ru/companies/${c.company_id}/team-explainer`}>О командной диагностике</Link></p>}</>}</Card></Container></main>;
}
