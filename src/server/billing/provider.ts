import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {billingConfig,verifiedEventSchema,type VerifiedBillingEvent,type Checkout} from './contracts';
export interface BillingProvider<Context=Checkout> {
 createCheckout(checkout:Context):Promise<{reference:string;customerRef:string;subscriptionRef:string;paymentRef:string;url:string}>;
 parseAndVerifyWebhook?(body:string,signature:string,now?:number):VerifiedBillingEvent;
 retrieveVerifiedPayment?(reference:string,context:Context):Promise<VerifiedBillingEvent|null>;
 retrieveCheckout?(reference:string):Promise<{status:string}>;
 cancelSubscription?(reference:string,mode:'now'|'period_end'):Promise<void>;
}
/** Separate, domain-bound HMAC format. Never a stand-in verifier for a real provider. */
export class MockBillingProvider implements BillingProvider {
 constructor(private readonly secret:string,private readonly env:Record<string,string|undefined>=process.env){
  if(!billingConfig(env).enabled||billingConfig(env).provider!=='mock'||secret.length<32)throw Error('billing_unavailable');
 }
 async createCheckout(checkout:Checkout){if(!checkout.test_mode)throw Error('billing_invalid_offer');return {reference:`mock-checkout-${checkout.id}`,customerRef:`mock-customer-${checkout.account_id}`,subscriptionRef:`mock-sub-${checkout.id}`,paymentRef:`mock-payment-${checkout.id}`,url:`/ru/billing/mock/${checkout.id}`};}
 sign(body:string,timestamp=Math.floor(Date.now()/1000)){
  const digest=createHmac('sha256',this.secret).update(`aca-mock-billing-v1.${timestamp}.${body}`).digest('hex');return `mock-v1,t=${timestamp},v=${digest}`;
 }
 parseAndVerifyWebhook(body:string,signature:string,now=Date.now()){
  if(Buffer.byteLength(body)>4096)throw Error('billing_invalid_event');
  const m=signature.match(/^mock-v1,t=(\d{10}),v=([a-f0-9]{64})$/);
  if(!m||Math.abs(now/1000-Number(m[1]))>300)throw Error('billing_invalid_signature');
  const expected=this.sign(body,Number(m[1])).split(',v=')[1];
  if(!timingSafeEqual(Buffer.from(m[2],'hex'),Buffer.from(expected,'hex')))throw Error('billing_invalid_signature');
  const event=verifiedEventSchema.parse(JSON.parse(body));if(event.provider!=='mock')throw Error('billing_invalid_event');return event;
 }
}
