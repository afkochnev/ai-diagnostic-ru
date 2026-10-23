import { z } from 'zod';
import { createTransactionalProvider,type ConsultationProvider,type ConsultationNotification } from "@/server/consultation/provider";
import {ConsultationDeliveryError,consultationResendConfig} from '@/server/consultation/config';
import {controlledTeamRequired,assertControlledTeamWindow,reserveControlledTeamEffect,completeControlledTeamEffect,assertControlledTeamEffectWindow,controlledTeamMillisecondsRemaining,type ControlledTeamContext} from '@/server-runtime/team-smoke';
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
   if(mode!=='resend'||!controlled)throw Error('controlled_team_unavailable');
   return new ControlledTeamInvitationProvider(controlled);
  }
  return createTransactionalProvider(mode);
}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export function teamInvitationMessage(input:{company:string;team:string;inviter:string;url:string;singleEmail?:boolean}) {
  const intro=`${input.inviter} / ${input.company} приглашает вас пройти командную диагностику AI Company Audit.`;
  const privacy="Организатор видит статус прохождения, но не ваши индивидуальные ответы.";
  const expiry=input.singleEmail?"Ссылка для входа действует 30 минут. Пароль не нужен: после согласия откроется ваша анкета.":"Ссылка приглашения действует 7 дней.";
  return {
    subject:`Приглашение в командную диагностику — ${input.company}`,
    text:`${intro}\n\n${input.team}\n\n${privacy}\n\nПринять приглашение: ${input.url}\n\n${expiry} Не пересылайте письмо. Если вы не ожидали приглашение, проигнорируйте его.`,
    html:`<h1>Вас пригласили пройти командную диагностику</h1><p>${escape(intro)}</p><h2>${escape(input.team)}</h2><p>${privacy}</p><p><a style="display:inline-block;padding:14px 22px;background:#315c73;color:white;text-decoration:none;border-radius:8px" href="${escape(input.url)}">Принять приглашение</a></p><p>${expiry} Не пересылайте письмо. Если вы не ожидали приглашение, проигнорируйте его.</p>`,
  };
}
