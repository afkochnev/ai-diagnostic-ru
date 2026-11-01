import { z } from 'zod';
import { createTransactionalProvider,type ConsultationProvider,type ConsultationNotification } from "@/server/consultation/provider";
import {ConsultationDeliveryError,consultationResendConfig} from '@/server/consultation/config';
import {controlledTeamRequired,assertControlledTeamWindow,reserveControlledTeamEffect,reserveControlledTeamW2Access,completeControlledTeamEffect,assertControlledTeamEffectWindow,controlledTeamMillisecondsRemaining,type ControlledTeamContext,type ControlledTeamW2Access} from '@/server-runtime/team-smoke';
type ControlledInvitation={context:ControlledTeamContext;participantId:string;invitationHash:string;recipient:string};
class ControlledTeamInvitationProvider implements ConsultationProvider {
 readonly name='resend';
 constructor(private readonly binding:ControlledInvitation){}
 async send(message:ConsultationNotification){
  const {context,participantId,invitationHash,recipient}=this.binding;
  assertControlledTeamWindow(context);
  if(!z.email().safeParse(message.to).success||message.to!==recipient||message.idempotencyKey!==`team-invitation/${participantId}/${invitationHash}`)throw new ConsultationDeliveryError('team_message_invalid',false);
  const {key,from}=consultationResendConfig();
  const effect=await reserveControlledTeamEffect(context,'invitation_email',{participantId});
  if(!effect||effect.recipient_email!==recipient||effect.invitation_hash!==invitationHash)throw new ConsultationDeliveryError('team_message_invalid',false);
  let outcome:'unknown'|'failed'='unknown';
  try{
   assertControlledTeamEffectWindow(effect);
   // Fixed host/path, no redirects, no SDK/retry layer. Reservation survives any
   // uncertain outcome, restart or repeated action; the caller never resends.
   const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',cache:'no-store',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':message.idempotencyKey},body:JSON.stringify({from,to:[effect.recipient_email],subject:message.subject,text:message.text,...(message.html?{html:message.html}:{})}),signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(15000,controlledTeamMillisecondsRemaining(effect)))))});
   if(!response.ok){outcome='failed';throw Error('team_delivery_failed');}
   const receipt=await response.json().catch(()=>null) as {id?:unknown}|null;
   if(typeof receipt?.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(receipt.id))throw Error('team_delivery_unknown');
   await completeControlledTeamEffect(effect,'succeeded',receipt.id);
   return {providerMessageId:receipt.id};
  }catch{
   await completeControlledTeamEffect(effect,outcome).catch(()=>{});
   throw new ConsultationDeliveryError('team_delivery_unconfirmed',false);
  }
 }
}
export function getTeamInvitationProvider(controlled?:ControlledInvitation) {
  const mode=process.env.TEAM_INVITATION_EMAIL_PROVIDER ?? process.env.EMAIL_PROVIDER ?? "resend";
  if(mode!=="mock" && mode!=="resend") throw new Error("team_email_provider_invalid");
  if(controlledTeamRequired()){
   if(mode!=='resend'||!controlled||controlled.context.window_id)throw Error('controlled_team_unavailable');
   return new ControlledTeamInvitationProvider(controlled);
  }
  return createTransactionalProvider(mode);
}

/** Dedicated continuation email; generic invitation/renewal paths stay closed.
 * No credential or message body is returned as an owner/evidence response. */
export async function sendControlledTeamW2AccessEmail(context:ControlledTeamContext,credential:ControlledTeamW2Access,url:string){
 assertControlledTeamWindow(context);
 if(!context.window_id||credential.window_id!==context.window_id||credential.run_id!==context.run_id||credential.team_id!==context.team_id||credential.participant_id!==context.participant_id||(process.env.TEAM_INVITATION_EMAIL_PROVIDER??process.env.EMAIL_PROVIDER??'resend')!=='resend')throw Error('controlled_team_unavailable');
 const parsed=new URL(url);
 if(parsed.origin!=='https://audit.iteam.ru'||parsed.pathname!=='/ru/team/join'||parsed.search||parsed.username||parsed.password||!/^#access=[A-Za-z0-9_-]{1,3072}$/.test(parsed.hash))throw Error('controlled_team_unavailable');
 const {key,from}=consultationResendConfig();
 const effect=await reserveControlledTeamW2Access(context,credential.participant_id,'access_email');
 if(effect.user_id!==credential.user_id||effect.recipient_email!==credential.recipient_email||effect.invitation_hash!==credential.invitation_hash)throw Error('controlled_team_unavailable');
 let dispatched=false;
 try{
  assertControlledTeamEffectWindow(effect);dispatched=true;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',cache:'no-store',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`team-w2-access/${context.run_id}/${context.window_id}/${effect.participant_id}`},body:JSON.stringify({from,to:[effect.recipient_email],subject:'Продолжение командной диагностики AI Company Audit',text:`Откройте вашу анкету командной диагностики: ${url}\n\nПароль не нужен. После вашего согласия откроется анкета. Ссылка действует не более 30 минут и до окончания текущего периода доступа. Организатор видит статус прохождения и агрегированные результаты, но не ваши индивидуальные ответы. Не пересылайте это письмо.`}),signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(15000,controlledTeamMillisecondsRemaining(effect)))))});
  if(!response.ok)throw Error('team_delivery_unconfirmed');
  const result=await response.json().catch(()=>null) as {id?:unknown}|null;
  if(typeof result?.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(result.id))throw Error('team_delivery_unconfirmed');
  await completeControlledTeamEffect(effect,'succeeded',result.id);
 }catch{
  await completeControlledTeamEffect(effect,dispatched?'unknown':'failed').catch(()=>{});
  throw Error('controlled_team_access_unconfirmed');
 }
}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export function teamInvitationMessage(input:{company:string;team:string;inviter:string;url:string;singleEmail?:boolean;accessExpiresAt?:number}) {
  const intro=`${input.inviter} / ${input.company} приглашает вас пройти командную диагностику AI Company Audit.`;
  const privacy="Организатор видит статус прохождения, но не ваши индивидуальные ответы.";
  const expiry=input.accessExpiresAt?`Ссылка для входа действует до ${new Date(input.accessExpiresAt).toLocaleString("ru-RU",{timeZone:"Europe/Moscow"})} (по московскому времени). Пароль не нужен: после согласия откроется ваша анкета.`:input.singleEmail?"Ссылка для входа действует 30 минут. Пароль не нужен: после согласия откроется ваша анкета.":"Ссылка приглашения действует 7 дней.";
  return {
    subject:`Приглашение в командную диагностику — ${input.company}`,
    text:`${intro}\n\n${input.team}\n\n${privacy}\n\nПринять приглашение: ${input.url}\n\n${expiry} Не пересылайте письмо. Если вы не ожидали приглашение, проигнорируйте его.`,
    html:`<h1>Вас пригласили пройти командную диагностику</h1><p>${escape(intro)}</p><h2>${escape(input.team)}</h2><p>${privacy}</p><p><a style="display:inline-block;padding:14px 22px;background:#315c73;color:white;text-decoration:none;border-radius:8px" href="${escape(input.url)}">Принять приглашение</a></p><p>${expiry} Не пересылайте письмо. Если вы не ожидали приглашение, проигнорируйте его.</p>`,
  };
}
