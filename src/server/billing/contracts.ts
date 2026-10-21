import {z} from 'zod';
export const eventTypes=['payment_succeeded','payment_failed','checkout_cancelled','subscription_cancel_pending','subscription_ended','subscription_payment_failed','payment_refunded'] as const;
const ref=z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
export const verifiedEventSchema=z.strictObject({provider:z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),event_ref:ref,type:z.enum(eventTypes),checkout_id:z.uuid(),subscription_ref:ref,payment_ref:ref,customer_ref:ref,occurred_at:z.iso.datetime({offset:true}),amount_minor:z.number().int().nonnegative().safe().nullable(),currency:z.string().regex(/^[A-Z]{3}$/).nullable()});
export type VerifiedBillingEvent=z.infer<typeof verifiedEventSchema>;
export const checkoutSchema=z.object({id:z.uuid(),account_id:z.uuid(),account_name:z.string(),company_id:z.uuid().nullable(),company_name:z.string().nullable(),status:z.enum(['created','pending','succeeded','failed','expired','cancelled']),expires_at:z.string(),plan:z.enum(['free','advanced']),test_mode:z.boolean()});
export type Checkout=z.infer<typeof checkoutSchema>;
export function billingConfig(env:Record<string,string|undefined>=process.env){
 const staging=env.APP_URL==='https://ai-diagnostic-staging-web.onrender.com'&&env.SUPABASE_URL==='https://vflgxgdwlftlyjslyrmo.supabase.co';
 const test=env.NODE_ENV!=='production'&&/^http:\/\/127\.0\.0\.1:\d+$/.test(env.APP_URL??'')&&/^http:\/\/127\.0\.0\.1:\d+$/.test(env.SUPABASE_URL??'');
 return {enabled:env.BILLING_ENABLED==='true'&&env.BILLING_PROVIDER==='mock'&&(staging||test),provider:'mock' as const};
}
export function teamContinuation(companyId:string|null){return companyId&&z.uuid().safeParse(companyId).success?`/ru/companies/${companyId}/diagnostics?new=1&type=team#team-create`:null;}
