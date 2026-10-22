import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {billingRpc} from './service';
import {commercialTermsRpc,type CommercialAcceptance} from './legal-contract';
import {YooKassaBillingProvider,YooKassaError,parseYooKassaNotification,yookassaContextSchema,type YooKassaContext} from './yookassa';
const resultSchema=z.object({status:z.enum(['processed','ignored','rejected','retryable']),error:z.string().nullable(),duplicate:z.boolean().optional()});
export type YooKassaDependencies={rpc:typeof billingRpc;provider:()=>YooKassaBillingProvider};
const runtime: YooKassaDependencies={rpc:billingRpc,provider:()=>new YooKassaBillingProvider(process.env,fetch,'verification')};

async function verify(c:YooKassaContext,deps:YooKassaDependencies){
 const {event,receiptState}=await deps.provider().retrieveVerifiedPaymentDetails(c.provider_payment_ref,c);
 await deps.rpc('billing_record_yookassa_receipt',{p_checkout_id:c.id,p_payment_ref:c.provider_payment_ref,p_state:receiptState},true);
 if(!event)return {status:'pending' as const,error:null};
 const canonical=JSON.stringify(event);
 return resultSchema.parse(await deps.rpc('billing_process_verified_event',{p_event:event,p_hash:createHash('sha256').update(canonical).digest('hex')},true));
}
export async function createYooKassaPayment(account:string,company:string|null,email:string,terms:CommercialAcceptance,deps=runtime){
 const legal= commercialTermsRpc(terms);
 const provider=deps.provider();provider.assertCheckoutReady();
 const id=z.uuid().parse(await deps.rpc('billing_start_yookassa_checkout',{p_account_id:z.uuid().parse(account),p_company_id:company===null?null:z.uuid().parse(company),...legal}));
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
 if(notification.event==='refund.succeeded'){
  const result=await reconcileFullRefund(notification.object.id,deps);
  if(result.status==='pending')throw new YooKassaError('billing_refund_unconfirmed',true);
  return result;
 }
 // Notification contributes only an ID. Every amount/status/metadata value comes from authenticated GET.
 const raw=await deps.rpc('billing_yookassa_payment_context',{p_payment_ref:notification.object.id},true);
 if(!raw)throw new YooKassaError('billing_payment_not_bound',true);
 return verify(yookassaContextSchema.parse(raw),deps);
}

export async function reconcileFullRefund(id:string,deps=runtime){
 const provider=deps.provider(),refund=await provider.retrieveRefund(id);
 const raw=await deps.rpc('billing_yookassa_payment_context',{p_payment_ref:refund.payment_id},true);
 if(!raw)throw new YooKassaError('billing_payment_not_bound',true);
 const c=yookassaContextSchema.parse(raw),r=await provider.verifyFullRefund(refund,c);
 return z.object({status:z.enum(['processed','pending','canceled']),duplicate:z.boolean()}).parse(await deps.rpc('billing_record_verified_refund',{
  p_checkout_id:c.id,p_payment_ref:c.provider_payment_ref,p_refund_ref:r.id,p_status:r.status,
  p_amount_minor:48000,p_currency:'RUB',p_created_at:r.created_at,p_receipt_state:r.receipt_registration??null,
 },true));
}
export async function createFullYooKassaRefund(checkoutId:string,deps=runtime){
 const request=z.object({id:z.uuid(),checkout_id:z.uuid(),created_at:z.string(),provider_refund_ref:z.string().nullable(),status:z.string()}).parse(await deps.rpc('billing_request_full_refund',{p_checkout_id:z.uuid().parse(checkoutId)}));
 if(request.checkout_id!==checkoutId)throw new YooKassaError('billing_refund_mismatch');
 const c=yookassaContextSchema.parse(await deps.rpc('billing_yookassa_refund_context',{p_checkout_id:checkoutId},true));
 const r=await deps.provider().createFullRefund(request,c);
 await deps.rpc('billing_bind_full_refund',{p_request_id:request.id,p_checkout_id:checkoutId,p_refund_ref:r.id},true);
 // POST response is not a financial proof. GET the refund and its payment again.
 return reconcileFullRefund(r.id,deps);
}
