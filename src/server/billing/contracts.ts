import {z} from 'zod';
import {billingEnvironmentAllowed} from './commercial';
export const eventTypes=['payment_succeeded','payment_failed','checkout_cancelled','subscription_cancel_pending','subscription_ended','subscription_payment_failed','payment_refunded'] as const;
const ref=z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
export const verifiedEventSchema=z.strictObject({provider:z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),event_ref:ref,type:z.enum(eventTypes),checkout_id:z.uuid(),subscription_ref:ref,payment_ref:ref,customer_ref:ref,occurred_at:z.iso.datetime({offset:true}),amount_minor:z.number().int().nonnegative().safe().nullable(),currency:z.string().regex(/^[A-Z]{3}$/).nullable()});
export type VerifiedBillingEvent=z.infer<typeof verifiedEventSchema>;
export const checkoutSchema=z.object({id:z.uuid(),account_id:z.uuid(),account_name:z.string(),company_id:z.uuid().nullable(),company_name:z.string().nullable(),status:z.enum(['created','pending','succeeded','failed','expired','cancelled']),expires_at:z.string(),plan:z.enum(['free','advanced']),test_mode:z.boolean(),provider_key:z.enum(['mock','yookassa']).default('mock'),effective_until:z.string().nullable().optional()});
export type Checkout=z.infer<typeof checkoutSchema>;
export function billingConfig(env:Record<string,string|undefined>=process.env){
 const provider=env.BILLING_PROVIDER==='yookassa'?'yookassa':'mock';
 return {enabled:env.BILLING_ENABLED==='true'&&['mock','yookassa'].includes(env.BILLING_PROVIDER??'')&&billingEnvironmentAllowed(env),provider};
}
export function teamContinuation(companyId:string|null){return companyId&&z.uuid().safeParse(companyId).success?`/ru/companies/${companyId}/diagnostics?new=1&type=team#team-create`:null;}
