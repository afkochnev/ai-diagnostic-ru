import {z} from 'zod';
import {launchEnvironment} from '@/server-runtime/launch-gates';
export const acquisitionCookie='aca-anonymous';
export const visitCookie='aca-journey';
export const sessionTtlSeconds=7*24*60*60;
export function acquisitionEnabled(env:Record<string,string|undefined>=process.env){
 return launchEnvironment('acquisition',env);
}
const safe=z.string().regex(/^[A-Za-z0-9._-]{1,100}$/);
export const attributionSchema=z.object({utm_source:safe.optional(),utm_medium:safe.optional(),utm_campaign:safe.optional(),utm_content:safe.optional(),referrer_host:safe.optional(),landing_variant:safe.optional()}).strict();
export function safeAttribution(raw:Record<string,unknown>){return Object.fromEntries(Object.entries(raw).filter(([k,v])=>k in attributionSchema.shape && safe.safeParse(v).success));}
const text=z.string().trim().min(1).max(5000);
const optionalText=z.string().trim().max(5000).optional().transform(v=>v||null);
const optionalInt=(min:number)=>z.preprocess(v=>v===''||v===undefined||v===null?null:v,z.coerce.number().int().min(min).max(10000).nullable());
export const shortProfileSchema=z.object({name:text.max(200),industry_key:z.string().min(1).max(80),employee_count:z.coerce.number().int().min(1).max(10000000),products:text,key_problems:text,main_goals:text,country:optionalText,customer_segments:optionalText,sales_channels:optionalText,annual_revenue_key:z.string().max(80).optional().transform(v=>v||null),company_age_years:optionalInt(0),management_levels:optionalInt(1)}).strict();
export const saveSchema=z.object({expected_revision:z.number().int().positive(),mutation_id:z.uuid(),current_block_id:z.uuid(),answers_dirty:z.boolean().default(true),answers:z.array(z.object({question_id:z.uuid(),value:z.union([z.number().min(0).max(4).int(),z.string().max(10000),z.null()])}).strict()).max(200)}).strict();
export const emailSchema=z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),display_name:z.string().trim().min(1).max(100),marketing_granted:z.boolean(),marketing_version:z.string().min(1).max(100)}).strict();
export type SessionView={id:string;visit_id:string;methodology_version_id:string;status:string;revision:number;current_block_id:string;answers:Record<string,string|number>;company_context_draft:Record<string,string|number|null>|null;consent_version:string;consented_at:string;marketing_version:string|null;expires_at:string;email_cooldown_seconds:number;email_requested_at:string|null;email_sent_at:string|null};
