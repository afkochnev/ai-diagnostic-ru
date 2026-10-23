import 'server-only';
import {z} from 'zod';
import type {BillingProvider} from './provider';
import {annualOffer,yookassaRuntimeMode,receiptSettings} from './commercial';
import {verifiedEventSchema,type VerifiedBillingEvent} from './contracts';
const paymentId=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
export const yookassaContextSchema=z.object({id:z.uuid(),account_id:z.uuid(),company_id:z.uuid().nullable(),offer_id:z.uuid(),offer_key:z.literal(annualOffer.key),amount_minor:z.literal(annualOffer.amount_minor),currency:z.literal(annualOffer.currency),merchant_ref:z.string().regex(/^\d{1,20}$/),provider_test_mode:z.boolean(),provider_payment_ref:z.string(),created_at:z.string(),status:z.string()});
export type YooKassaContext=z.infer<typeof yookassaContextSchema>;
const paymentSchema=z.object({id:paymentId,status:z.enum(['pending','waiting_for_capture','succeeded','canceled']),paid:z.boolean(),test:z.boolean(),receipt_registration:z.enum(['pending','succeeded','canceled']).optional(),amount:z.object({value:z.string().regex(/^\d+\.\d{2}$/),currency:z.string()}),refunded_amount:z.object({value:z.string().regex(/^\d+\.\d{2}$/),currency:z.string()}).optional(),recipient:z.object({account_id:z.string()}),metadata:z.object({checkout_id:z.uuid(),account_id:z.uuid(),offer_id:z.uuid()}),created_at:z.iso.datetime({offset:true}),captured_at:z.iso.datetime({offset:true}).optional(),cancellation_details:z.object({reason:z.string(),party:z.string()}).optional(),confirmation:z.object({type:z.string(),confirmation_url:z.string().optional()}).optional()});
type Payment=z.infer<typeof paymentSchema>;
export const refundSchema=z.object({id:paymentId,payment_id:paymentId,status:z.enum(['pending','succeeded','canceled']),amount:z.object({value:z.string(),currency:z.string()}),created_at:z.iso.datetime({offset:true}),receipt_registration:z.enum(['pending','succeeded','canceled']).optional()});
export type YooKassaRefund=z.infer<typeof refundSchema>;
export type FullRefundRequest={id:string;created_at:string;provider_refund_ref:string|null;status:string};
export type YooKassaFetch=(url:string,init:RequestInit)=>Promise<Response>;
export class YooKassaError extends Error {
 constructor(readonly code:string,readonly retryable=false){super(code);}
}
export function yookassaConfigured(env:Record<string,string|undefined>=process.env){
 return env.BILLING_ENABLED==='true'&&yookassaVerificationConfigured(env)&&(yookassaRuntimeMode(env)==='test'||annualOffer.productionEnabled===true);
}
export function yookassaVerificationConfigured(env:Record<string,string|undefined>=process.env){
 return yookassaRuntimeMode(env)!==null&&env.YOOKASSA_RECONCILIATION_ENABLED!=='false';
}
export function parseYooKassaNotification(body:string){
 if(Buffer.byteLength(body)>16384)throw new YooKassaError('billing_invalid_notification');
 try {return z.object({type:z.literal('notification'),event:z.enum(['payment.succeeded','payment.canceled','payment.waiting_for_capture','refund.succeeded']),object:z.object({id:paymentId})}).parse(JSON.parse(body));}
 catch {throw new YooKassaError('billing_invalid_notification');}
}
export class YooKassaBillingProvider implements BillingProvider<YooKassaContext> {
 constructor(private readonly env:Record<string,string|undefined>=process.env,private readonly transport:YooKassaFetch=fetch,mode:'payments'|'verification'='payments'){
  if(!(mode==='verification'?yookassaVerificationConfigured(env):yookassaConfigured(env)))throw new YooKassaError('billing_unavailable');
 }
 assertCheckoutReady(){if(!yookassaConfigured(this.env))throw new YooKassaError('billing_unavailable');receiptSettings(this.env);}
 private context(value:YooKassaContext){
  const c=yookassaContextSchema.parse(value),mode=yookassaRuntimeMode(this.env);
  if(mode===null||c.provider_test_mode!==(mode==='test')||c.merchant_ref!==this.env.YOOKASSA_SHOP_ID)throw new YooKassaError('billing_verification_mismatch');
  return c;
 }
 private async requestData(path:string,method:'GET'|'POST',body?:unknown,idempotency?:string):Promise<unknown>{
  // No configurable API host, no redirects, no provider response or credential in error/log output.
  let response:Response;
  try{response=await this.transport('https://api.yookassa.ru/v3/'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Basic '+Buffer.from(this.env.YOOKASSA_SHOP_ID+':'+this.env.YOOKASSA_SECRET_KEY).toString('base64'),'Content-Type':'application/json',...(idempotency?{'Idempotence-Key':idempotency}:{})},body:body===undefined?undefined:JSON.stringify(body)});}catch{throw new YooKassaError('billing_provider_unavailable',true);}
  if(!response.ok){await response.body?.cancel();throw new YooKassaError('billing_provider_rejected',response.status===429||response.status>=500);}
  const reader=response.body?.getReader();if(!reader)throw new YooKassaError('billing_provider_invalid');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error();}chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw new YooKassaError('billing_provider_invalid',true);}
 }
 private async request(path:string,method:'GET'|'POST',body?:unknown,idempotency?:string):Promise<Payment>{
  const raw=await this.requestData(path,method,body,idempotency),parsed=paymentSchema.safeParse(raw);
  if(!parsed.success)throw new YooKassaError('billing_provider_invalid',true);return parsed.data;
 }
 private validate(payment:Payment,c:YooKassaContext){
  if(payment.recipient.account_id!==this.env.YOOKASSA_SHOP_ID||payment.recipient.account_id!==c.merchant_ref||payment.test!==c.provider_test_mode||payment.test!==(yookassaRuntimeMode(this.env)==='test')||payment.amount.value!==annualOffer.receiptItem.amount.value||payment.amount.currency!==c.currency||payment.metadata.checkout_id!==c.id||payment.metadata.account_id!==c.account_id||payment.metadata.offer_id!==c.offer_id)throw new YooKassaError('billing_verification_mismatch');
  if(Date.parse(payment.created_at)<Date.parse(c.created_at)-1000||Date.parse(payment.created_at)>Date.now()+300000)throw new YooKassaError('billing_verification_mismatch');
 }
 // Explicit read-only configuration preflight; never creates a payment or infers fiscal parameters.
 async inspectMerchantConfiguration(){
  const schema=z.object({account_id:z.string(),status:z.enum(['enabled','disabled']),test:z.boolean(),itn:z.string().optional(),fiscalization:z.object({enabled:z.boolean(),provider:z.string()}).optional()});
  const parsed=schema.safeParse(await this.requestData('me','GET'));
  if(!parsed.success)throw new YooKassaError('billing_merchant_unconfirmed');
  const m=parsed.data,mode=yookassaRuntimeMode(this.env);
  if(m.account_id!==this.env.YOOKASSA_SHOP_ID||m.test!==(mode==='test')||m.status!=='enabled'||(mode==='production'&&(m.itn!=='7703381761'||m.fiscalization?.enabled!==true)))throw new YooKassaError('billing_merchant_unconfirmed');
  return {merchantMatches:true,test:m.test,enabled:true,fiscalizationEnabled:m.fiscalization?.enabled===true};
 }
 async createCheckout(c:YooKassaContext,email?:string){
  this.assertCheckoutReady();const receiptEmail=z.email().parse(email);c=this.context(c);
  // A timeout is retried only with this persisted key, within YooKassa's idempotency window.
  if(Date.now()-Date.parse(c.created_at)>23*60*60*1000)throw new YooKassaError('billing_checkout_reconciliation_required');
  const settings=receiptSettings(this.env);
  if(yookassaRuntimeMode(this.env)==='production')await this.inspectMerchantConfiguration();
  const receipt={customer:{email:receiptEmail},items:[{...annualOffer.receiptItem,payment_mode:settings.payment_mode,...(settings.measure?{measure:settings.measure}:{})}],...(settings.tax_system_code===undefined?{}:{tax_system_code:settings.tax_system_code})};
  const p=await this.request('payments','POST',{amount:annualOffer.receiptItem.amount,capture:true,confirmation:{type:'redirect',return_url:`${this.env.APP_URL}/ru/billing/return?checkout=${c.id}`},description:annualOffer.receiptItem.description,save_payment_method:false,metadata:{checkout_id:c.id,account_id:c.account_id,offer_id:c.offer_id},receipt},c.id);
  this.validate(p,c);
  if(!c.provider_payment_ref.startsWith('reserved-')&&p.id!==c.provider_payment_ref)throw new YooKassaError('billing_verification_mismatch');
  if(p.status!=='pending')return {reference:p.id,customerRef:`account-${c.account_id}`,subscriptionRef:`annual-${c.id}`,paymentRef:p.id,url:`/ru/billing/return?checkout=${c.id}`};
  const raw=p.confirmation?.confirmation_url;let url:URL;
  try{url=new URL(raw??'');if(url.protocol!=='https:'||!['yoomoney.ru','yookassa.ru','checkout.yookassa.ru'].includes(url.hostname)||url.username||url.password||url.port)throw Error();}catch{throw new YooKassaError('billing_confirmation_invalid');}
  return {reference:p.id,customerRef:`account-${c.account_id}`,subscriptionRef:`annual-${c.id}`,paymentRef:p.id,url:url.href};
 }
 async retrieveVerifiedPayment(id:string,c:YooKassaContext):Promise<VerifiedBillingEvent|null>{
  return (await this.retrieveVerifiedPaymentDetails(id,c)).event;
 }
 async retrieveVerifiedPaymentDetails(id:string,c:YooKassaContext){
  paymentId.parse(id);c=this.context(c);
  if(id!==c.provider_payment_ref)throw new YooKassaError('billing_verification_mismatch');
  const p=await this.request('payments/'+id,'GET');
  if(p.id!==id)throw new YooKassaError('billing_verification_mismatch');this.validate(p,c);
  // A refunded payment cannot grant another year; verified full refunds use their own reconciliation path.
  if(p.refunded_amount&&(p.refunded_amount.value!=='0.00'||p.refunded_amount.currency!==c.currency))throw new YooKassaError('billing_refund_reconciliation_required');
  if(p.status==='pending'||p.status==='waiting_for_capture')return {event:null,receiptState:p.receipt_registration??null};
  if((p.status==='succeeded'&&!p.paid)||(p.status==='canceled'&&p.paid))throw new YooKassaError('billing_verification_mismatch');
  if(p.status==='succeeded'&&!p.captured_at)throw new YooKassaError('billing_verification_mismatch');
  const at=p.captured_at??p.created_at;
  if(Date.parse(at)<Date.parse(c.created_at)-1000||Date.parse(at)>Date.now()+300000)throw new YooKassaError('billing_verification_mismatch');
  const event=verifiedEventSchema.parse({provider:'yookassa',event_ref:`${id}-${p.status}`,type:p.status==='succeeded'?'payment_succeeded':'checkout_cancelled',checkout_id:c.id,subscription_ref:`annual-${c.id}`,payment_ref:id,customer_ref:`account-${c.account_id}`,occurred_at:new Date(at).toISOString(),amount_minor:annualOffer.amount_minor,currency:annualOffer.currency});
  return {event,receiptState:p.receipt_registration??null};
 }
 async retrieveRefund(id:string){
  paymentId.parse(id);
  const parsed=refundSchema.safeParse(await this.requestData('refunds/'+id,'GET'));
  if(!parsed.success||parsed.data.id!==id)throw new YooKassaError('billing_refund_invalid');
  return parsed.data;
 }
 private validateRefund(r:YooKassaRefund,c:YooKassaContext){
  if(r.payment_id!==c.provider_payment_ref||r.amount.value!=='480.00'||r.amount.currency!=='RUB'||Date.parse(r.created_at)<Date.parse(c.created_at)-1000||Date.parse(r.created_at)>Date.now()+300000)throw new YooKassaError('billing_refund_mismatch');
 }
 async verifyFullRefund(r:YooKassaRefund,c:YooKassaContext){
  c=this.context(c);r=refundSchema.parse(r);this.validateRefund(r,c);
  const p=await this.request('payments/'+paymentId.parse(c.provider_payment_ref),'GET');
  this.validate(p,c);
  if(p.id!==c.provider_payment_ref||p.status!=='succeeded'||!p.paid||!p.captured_at||Date.parse(p.captured_at)<Date.parse(c.created_at)-1000||Date.parse(p.captured_at)>Date.now()+300000)throw new YooKassaError('billing_refund_mismatch');
  // Refunds have no test/merchant fields: prove both from the original payment GET.
  if(r.status==='succeeded'&&(p.refunded_amount?.value!=='480.00'||p.refunded_amount.currency!=='RUB'))throw new YooKassaError('billing_refund_payment_unconfirmed',true);
  return r;
 }
 async createFullRefund(request:FullRefundRequest,c:YooKassaContext){
  if(this.env.YOOKASSA_REFUNDS_ENABLED!=='true')throw new YooKassaError('billing_refunds_disabled');
  c=this.context(c);z.uuid().parse(request.id);
  if(request.provider_refund_ref)return this.retrieveRefund(request.provider_refund_ref);
  if(request.status!=='requested'||!Number.isFinite(Date.parse(request.created_at))||Date.now()-Date.parse(request.created_at)>23*3600000||Date.parse(request.created_at)>Date.now()+300000)throw new YooKassaError('billing_refund_reconciliation_required');
  receiptSettings(this.env);
  if(this.env.YOOKASSA_REFUND_RECEIPT_MODE!=='from_original_payment')throw new YooKassaError('billing_refund_receipt_unconfirmed');
  const p=await this.request('payments/'+paymentId.parse(c.provider_payment_ref),'GET');this.validate(p,c);
  if(p.id!==c.provider_payment_ref||p.status!=='succeeded'||!p.paid||!p.captured_at||Date.parse(p.captured_at)<Date.parse(c.created_at)-1000||Date.parse(p.captured_at)>Date.now()+300000||p.receipt_registration!=='succeeded'||(p.refunded_amount&&(p.refunded_amount.currency!=='RUB'||!['0.00','480.00'].includes(p.refunded_amount.value))))throw new YooKassaError('billing_refund_not_available');
  // Full refund, confirmed receipt-from-original configuration. No partial amount
  // or new idempotency key, including after an ambiguous transport failure.
  const r=refundSchema.safeParse(await this.requestData('refunds','POST',{payment_id:c.provider_payment_ref,amount:{value:'480.00',currency:'RUB'}},request.id));
  if(!r.success)throw new YooKassaError('billing_refund_invalid');this.validateRefund(r.data,c);return r.data;
 }
}
