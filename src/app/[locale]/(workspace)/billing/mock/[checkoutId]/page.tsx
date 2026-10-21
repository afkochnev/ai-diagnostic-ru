import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireIdentity} from '@/server/auth/session';
import {billingConfig} from '@/server/billing/contracts';
import {readCheckout} from '@/server/billing/service';
import {simulatePayment} from '@/server/billing/actions';
import {Container} from '@/components/ui/container';
import {Card} from '@/components/ui/card';
export default async function Page({params}:{params:Promise<{checkoutId:string}>}){
 await requireIdentity();if(!billingConfig().enabled)notFound();
 let c;try{c=await readCheckout((await params).checkoutId);}catch{notFound();}
 return <main id="main-content" className="py-10"><Container><Card><p className="font-semibold">Тестовый режим оплаты</p><h1 className="mt-4 text-3xl font-semibold">Тестовая оплата Advanced</h1><p className="mt-4">Реальные деньги не списываются. Платёжные данные вводить не нужно.</p><p className="mt-4">Аккаунт: {c.account_name}</p>{c.company_name&&<p className="mt-2">Компания: {c.company_name}</p>}<p className="mt-4">Вы подключаете командные диагностики, командные AI-отчёты и PDF, а также работу с несколькими компаниями.</p>{['created','pending'].includes(c.status)?<form action={simulatePayment} className="mt-6 flex flex-wrap gap-4"><input type="hidden" name="checkout" value={c.id}/><button className="rounded-xl bg-brand px-5 py-3 text-white" name="outcome" value="payment_succeeded">Симулировать успешную оплату</button><button className="rounded-xl border px-5 py-3" name="outcome" value="payment_failed">Симулировать отказ оплаты</button><button className="rounded-xl border px-5 py-3" name="outcome" value="checkout_cancelled">Отменить тестовую оплату</button></form>:<Link className="mt-6 inline-block underline" href={`/ru/billing/return?checkout=${c.id}`}>Проверить результат оплаты</Link>}<p className="mt-5"><Link className="underline" href={`/ru/account/plan?account=${c.account_id}`}>Вернуться к Advanced</Link></p></Card></Container></main>;
}
