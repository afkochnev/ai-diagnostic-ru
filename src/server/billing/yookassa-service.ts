import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {billingRpc} from './service';
import {YooKassaBillingProvider,YooKassaError,parseYooKassaNotification,yookassaContextSchema,type YooKassaContext} from './yookassa';
const resultSchema=z.object({status:z.enum(['processed','ignored','rejected','retryable']),error:z.string().nullable(),duplicate:z.boolean().optional()});
export type YooKassaDependencies={rpc:typeof billingRpc;provider:()=>YooKassaBillingProvider};
const runtime: YooKassaDependencies={rpc:billingRpc,provider:()=>new YooKassaBillingProvider()};

async function verify(c:YooKassaContext,deps:YooKassaDependencies){
 const event=await deps.provider().retrieveVerifiedPayment(c.provider_payment_ref,c);
 if(!event)return {status:'pending' as const,error:null};
 const canonical=JSON.stringify(event);
 return resultSchema.parse(await deps.rpc('billing_process_verified_event',{p_event:event,p_hash:createHash('sha256').update(canonical).digest('hex')},true));
}
export async function createYooKassaPayment(account:string,company:string|null,email:string,deps=runtime){
 const provider=deps.provider();provider.assertCheckoutReady();
 const id=z.uuid().parse(await deps.rpc('billing_start_yookassa_checkout',{p_account_id:z.uuid().parse(account),p_company_id:company===null?null:z.uuid().parse(company)}));
 const c=yookassaContextSchema.parse(await deps.rpc('billing_yookassa_owner_context',{p_checkout_id:id}));
 if(!c.provider_payment_ref.startsWith('reserved-')){
  const checked=await verify(c,deps);
  if(checked.status==='rejected'||checked.status==='retryable')throw new YooKassaError('billing_payment_reconciliation_required',true);
  if(checked.status!=='pending'||Date.now()-Date.parse(c.created_at)>23*3600000)return `/ru/billing/return?checkout=${id}`;
 }
 const created=await provider.createCheckout(c,email);
 await deps.rpc('billing_bind_yookassa_payment',{p_checkout_id:id,p_payment_ref:created.paymentRef},true);
 return created.url;
}
export async function reconcileYooKassaCheckout(id:string,deps=runtime){
 const c=yookassaContextSchema.parse(await deps.rpc('billing_yookassa_owner_context',{p_checkout_id:z.uuid().parse(id)}));
 if(c.provider_payment_ref.startsWith('reserved-'))return {status:'pending',error:null};
 return verify(c,deps);
}
export async function processYooKassaWebhook(body:string,deps=runtime){
 const notification=parseYooKassaNotification(body);
 // Notification contributes only an ID. Every amount/status/metadata value comes from authenticated GET.
 const raw=await deps.rpc('billing_yookassa_payment_context',{p_payment_ref:notification.object.id},true);
 if(!raw)throw new YooKassaError('billing_payment_not_bound',true);
 return verify(yookassaContextSchema.parse(raw),deps);
}
