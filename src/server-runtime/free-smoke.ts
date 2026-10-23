import {createHash,timingSafeEqual} from 'node:crypto';
import {createAdminClient} from '@/server-runtime/supabase/admin';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Env=Record<string,string|undefined>;
export const freeSmokeCookie='aca-controlled-free';
const fields=['FREE_SMOKE_RUN_ID','FREE_SMOKE_EXPIRES_AT','FREE_SMOKE_ADMISSION_SHA256','FREE_SMOKE_EMAIL'] as const;
/** Disabled by default. A partially installed profile fails closed. No secret is returned. */
export function freeSmokeConfig(env:Env=process.env,now=Date.now()){
 if(fields.every(k=>env[k]===undefined))return null;
 const run=env.FREE_SMOKE_RUN_ID,expires=Date.parse(env.FREE_SMOKE_EXPIRES_AT??''),digest=env.FREE_SMOKE_ADMISSION_SHA256,email=env.FREE_SMOKE_EMAIL;
 if(env.APP_URL!=='https://audit.iteam.ru'||env.SUPABASE_URL!=='https://fhvxqeaujjeiflanqsbg.supabase.co'||env.NODE_ENV!=='production'
 ||!run||!uuid.test(run)||!digest||!/^[a-f0-9]{64}$/.test(digest)||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email!==email.trim().toLowerCase()
 ||!Number.isFinite(expires)||expires<=now||expires-now>3600000||Math.floor(expires/86400000)!==Math.floor(now/86400000))throw Error('controlled_free_unavailable');
 return {run,expires,digest,email};
}
export function freeSmokeAdmission(token:string|undefined,env:Env=process.env,now=Date.now()){
 const config=freeSmokeConfig(env,now);if(!config)return true;
 if(!token||!/^[a-f0-9]{64}$/.test(token))return false;
 return timingSafeEqual(createHash('sha256').update(token).digest(),Buffer.from(config.digest,'hex'));
}
export function freeSmokeLimit(kind:'start'|'email'|'ai',env:Env=process.env,now=Date.now()){
 const config=freeSmokeConfig(env,now);return config?{p_key:`v27-free:${config.run}:${kind}`,p_limit:1,p_window_seconds:86400}:null;
}
export function assertFreeSmokeDiagnostic(id:string|undefined,env:Env=process.env){
 if(freeSmokeConfig(env)&&(!id||id!==env.FREE_SMOKE_DIAGNOSTIC_ID||!uuid.test(id)))throw Error('controlled_free_target_required');
}

/** Runtime-only shared reservation: no browser/Next dependencies in the worker. */
export async function reserveFreeSmokeBudget(kind:'start'|'email'|'ai',diagnosticId?:string){
 const args=freeSmokeLimit(kind);if(!args)return;
 if(kind==='ai')assertFreeSmokeDiagnostic(diagnosticId);
 const {data,error}=await createAdminClient().rpc('consume_rate_limit',args);
 if(error||data?.allowed!==true)throw Error('controlled_free_budget_consumed');
 // Never release after errors, timeouts or process restarts.
}
