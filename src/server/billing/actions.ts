'use server';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {z} from 'zod';
import {requireIdentity} from '@/server/auth/session';
import {requireAccountWrite} from '@/server/account/authorization';
import {authConfig} from '@/server/supabase/config';
import {enforceRateLimit} from '@/server/rate-limit';
import {billingRpc,mockProvider,processWebhook,readCheckout} from './service';
import {billingConfig,verifiedEventSchema} from './contracts';
async function guard(){if(!billingConfig().enabled||(await headers()).get('origin')!==authConfig().APP_URL)throw Error('billing_unavailable');return requireIdentity();}
export async function startCheckout(form:FormData){
 const identity=await guard(),account=z.uuid().parse(form.get('account'));
 await requireAccountWrite(account,identity.user.id);await enforceRateLimit(`billing:start:${identity.user.id}`,20,60);
 const company=z.uuid().nullable().parse(form.get('company')||null);
 let target:string;
 try {const id=z.uuid().parse(await billingRpc('billing_start_checkout',{p_account_id:account,p_company_id:company}));const created=await mockProvider().createCheckout(await readCheckout(id));await billingRpc('billing_bind_checkout',{p_checkout_id:id,p_checkout_ref:created.reference,p_customer_ref:created.customerRef,p_subscription_ref:created.subscriptionRef,p_payment_ref:created.paymentRef},true);target=created.url;}
 catch {redirect(`/ru/account/plan?account=${account}${company?`&company=${company}`:''}&billingError=1`);}
 redirect(target);
}
export async function simulatePayment(form:FormData){
 const identity=await guard(),id=z.uuid().parse(form.get('checkout')),kind=z.enum(['payment_succeeded','payment_failed','checkout_cancelled']).parse(form.get('outcome'));
 const c=await readCheckout(id);await requireAccountWrite(c.account_id,identity.user.id);
 if(!c.test_mode||!['created','pending'].includes(c.status)||Date.parse(c.expires_at)<=Date.now())redirect(`/ru/billing/return?checkout=${id}`);
 await enforceRateLimit(`billing:mock:${identity.user.id}`,30,60);
 const event=verifiedEventSchema.parse({provider:'mock',event_ref:`${kind}-${c.id}`,type:kind,checkout_id:c.id,subscription_ref:`mock-sub-${c.id}`,payment_ref:`mock-payment-${c.id}`,customer_ref:`mock-customer-${c.account_id}`,occurred_at:new Date().toISOString(),amount_minor:null,currency:null});
 const body=JSON.stringify(event),result=await processWebhook(body,mockProvider().sign(body));
 if(result.status==='retryable'||result.status==='rejected')redirect(`/ru/billing/return?checkout=${id}&processingError=1`);
 redirect(`/ru/billing/return?checkout=${id}`);
}
