import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {createAuthClient} from '@/server/supabase/server';
import {createAdminClient} from '@/server/supabase/admin';
import {authConfig} from '@/server/supabase/config';
import {requireAdmin} from '@/server/auth/admin';
import {billingConfig,checkoutSchema} from './contracts';
import {MockBillingProvider} from './provider';
type RpcClient={rpc(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>};
export async function billingRpc(name:string,args:Record<string,unknown>,privileged=false){
 const client=(privileged?createAdminClient():await createAuthClient()) as unknown as RpcClient;
 const {data,error}=await client.rpc(name,args);if(error)throw Error('billing_unavailable');return data;
}
export function mockProvider(){if(!billingConfig().enabled)throw Error('billing_unavailable');return new MockBillingProvider(authConfig().AUTH_FLOW_SECRET);}
export async function readCheckout(id:string,returned=false){return checkoutSchema.parse(await billingRpc('billing_read_checkout',{p_checkout_id:z.uuid().parse(id),p_returned:returned}));}
export async function processWebhook(body:string,signature:string){
 const event=mockProvider().parseAndVerifyWebhook(body,signature);
 return z.object({status:z.enum(['processed','ignored','rejected','retryable']),error:z.string().nullable(),duplicate:z.boolean().optional()}).parse(await billingRpc('billing_process_verified_event',{p_event:event,p_hash:createHash('sha256').update(body).digest('hex')},true));
}
const billingRow=z.object({id:z.uuid(),name:z.string(),plan:z.string(),source:z.string(),provider_key:z.string().nullable(),customer_ref:z.string().nullable(),subscription_ref:z.string().nullable(),subscription_status:z.string().nullable(),effective_from:z.string().nullable(),effective_until:z.string().nullable(),checkout_id:z.uuid().nullable(),checkout_status:z.string().nullable(),payment_status:z.string().nullable(),created_at:z.string(),updated_at:z.string(),provider_managed:z.boolean()});
export const billingFilters=z.object({q:z.string().max(100).optional(),account:z.uuid().optional(),plan:z.enum(['','free','advanced']).optional(),provider:z.enum(['','mock']).optional(),status:z.enum(['','pending','active','cancel_pending','ended','payment_failed']).optional(),payment:z.enum(['','pending','succeeded','failed','refunded','partially_refunded']).optional(),from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),page:z.coerce.number().int().min(1).max(10000).default(1)});
export async function adminBilling(raw:Record<string,unknown>={}){
 await requireAdmin();const filters=billingFilters.parse(raw);
 return z.object({rows:z.array(billingRow).max(25),total:z.number(),page:z.number(),page_size:z.literal(25),events:z.array(z.object({id:z.uuid(),account_id:z.uuid(),event_type:z.string(),received_at:z.string(),provider_key:z.string(),processing_status:z.string().nullable(),safe_error_code:z.string().nullable()})).max(25),health:z.object({webhook_failures:z.number(),unprocessed_events:z.number(),stale_checkouts:z.number(),payment_failures:z.number()})}).parse(await billingRpc('billing_admin_read',{p_filters:filters}));
}
