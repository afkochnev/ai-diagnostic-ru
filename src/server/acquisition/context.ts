import 'server-only';
import {createHash,randomBytes} from 'node:crypto';
import {cookies,headers} from 'next/headers';
import {authConfig} from '@/server/supabase/config';
import {enforceRateLimit} from '@/server/rate-limit';
import {acquisitionEnabled,sessionTtlSeconds,acquisitionCookie,visitCookie} from './contracts';
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const newSecret=()=>randomBytes(32).toString('hex');
export function decodeCookie(value:string|undefined){const m=value?.match(/^([a-f0-9-]{36})\.([a-f0-9]{64})$/);return m?{id:m[1],secret:m[2],hash:hash(m[2])}:null;}
export async function cookieContext(name=acquisitionCookie){
 if(!acquisitionEnabled())throw Error('acquisition_unavailable');
 const context=decodeCookie((await cookies()).get(name)?.value);if(!context)throw Error('acquisition_cookie_missing');return context;
}
export async function setContext(name:string,id:string,secret:string,maxAge=sessionTtlSeconds){
 (await cookies()).set(name,`${id}.${secret}`,{httpOnly:true,secure:authConfig().secure,sameSite:'lax',path:'/',maxAge});
}
export async function clearAnonymous(){(await cookies()).set(acquisitionCookie,'',{httpOnly:true,secure:authConfig().secure,sameSite:'lax',path:'/',maxAge:0});}
export async function guardOrigin(){if(!acquisitionEnabled() || (await headers()).get('origin')!==authConfig().APP_URL)throw Error('acquisition_origin');}
export async function limit(scope:string,key:string,count:number,seconds:number){await enforceRateLimit(`acquisition:${scope}:${hash(key)}`,count,seconds);}
export async function ipLimit(){const h=await headers();const ip=h.get('x-forwarded-for')?.split(',')[0]?.trim()??'unknown';await limit('create',ip,20,3600);}
export {visitCookie};
