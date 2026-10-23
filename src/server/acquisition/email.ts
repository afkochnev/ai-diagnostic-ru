import 'server-only';
import {createAdminClient} from '@/server-runtime/supabase/admin';
import {authConfig} from '@/server/supabase/config';
import {sealInvitationAuthProof,openInvitationAuthProof} from '@/server/team/invitation-auth-proof';
import {createTransactionalProvider} from '@/server/consultation/provider';
import {hash,newSecret} from './context';
import {requireFreeSmokeAdmission,reserveFreeSmoke} from './smoke';
import {sessionRpc} from './service';
import type {emailSchema} from './contracts';
import type {z} from 'zod';
export const proofSecret=()=>`anonymous-access/v1/${authConfig().AUTH_FLOW_SECRET}`;
export function accessProof(envelope:string,id:string){return openInvitationAuthProof(envelope,hash(id),proofSecret());}
export function accessMessage(url:string){return {subject:'Ваш персональный AI-отчёт — доступ к результатам',text:`Чтобы подтвердить email и получить отчёт, откройте ссылку:\n${url}\n\nСсылка действует 30 минут. Пароль не нужен. Не пересылайте письмо.`,html:`<h1>Получите персональный AI-отчёт</h1><p>Подтвердите email, чтобы сохранить результаты диагностики.</p><p><a href="${url.replaceAll('&','&amp;')}">Открыть мой AI-отчёт</a></p><p>Ссылка действует 30 минут. Пароль не нужен. Не пересылайте письмо.</p>`};}
export async function requestAccess(id:string,secretHash:string,input:z.infer<typeof emailSchema>){
 await requireFreeSmokeAdmission(input.email);
 // Reserve before mutating pending link state: a second attempt cannot invalidate the first link.
 await reserveFreeSmoke('email');
 const nonce=newSecret();
 const reserved=await sessionRpc<{reserved:boolean;create_user?:boolean;generation?:number}>('email',id,secretHash,{...input,nonce_hash:hash(nonce)});
 if(!reserved.reserved)return;
 const admin=createAdminClient(),type=reserved.create_user?'invite':'magiclink';
 const generated=await admin.auth.admin.generateLink({type,email:input.email,options:{redirectTo:`${authConfig().APP_URL}/ru/free/confirm`,...(reserved.create_user?{data:{anonymous_pending_nonce:nonce}}:{})}});
 if(generated.error)console.warn('[acquisition]',{event:'access_generation_failed',status:generated.error.status??null,code:/^[a-z_]+$/.test(generated.error.code??'')?generated.error.code:'unavailable'});
 if(generated.error || generated.data.properties?.verification_type!==type || generated.data.user?.email?.toLowerCase()!==input.email)throw Error('acquisition_email_unavailable');
 const envelope=sealInvitationAuthProof({email:input.email,invitationHash:hash(id),tokenHash:generated.data.properties.hashed_token,type},proofSecret());
 // Fragment prevents credentials from entering normal HTTP access logs/referrers.
 const url=`${authConfig().APP_URL}/ru/free/confirm#session=${id}&access=${envelope}`;
 const mode=process.env.ACQUISITION_EMAIL_PROVIDER??'mock';

 if(mode!=='mock' && mode!=='resend')throw Error('acquisition_email_unavailable');
 await createTransactionalProvider(mode).send({to:input.email,...accessMessage(url),idempotencyKey:`acquisition/${id}/${reserved.generation}`});
 await sessionRpc('email_sent',id,secretHash,{generation:reserved.generation});
 // Never log destination, envelope, nonce, token, or source text.
}
