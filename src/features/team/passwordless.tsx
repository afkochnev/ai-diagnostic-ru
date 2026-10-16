"use client";
import {useActionState,useEffect,useState} from "react";
import Link from "next/link";
import {sendTeamCodeAction} from "@/server/team/passwordless-actions";
import {continueSingleEmailAction} from "@/server/team/single-email-actions";
import {switchTeamInvitationAccountAction} from "@/server/team/actions";
import type {TeamEntryView} from "@/server/team/entry-context";
import {getMessages} from "@/i18n/messages";
export type TeamEntryPolicy={versions:Record<string,string>;temporary:boolean;dataUrl:string;marketingUrl:string};
const button="min-h-12 rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-60";
export function TeamPasswordless({policy,view}:{policy:TeamEntryPolicy;view:TeamEntryView}){
  const [sent,send,sending]=useActionState(view.singleEmail?continueSingleEmailAction:sendTeamCodeAction,{});
  const [switched,switchAccount,switching]=useActionState(switchTeamInvitationAccountAction,{});
  const [now,setNow]=useState(0),[consented,setConsented]=useState(false);
  useEffect(()=>{const tick=()=>setNow(Date.now());const timer=window.setInterval(tick,1000);return()=>window.clearInterval(timer);},[]);
  const contextExpires=sent.contextExpires??view.expires;
  const expired=view.phase==="expired" || sent.phase==="expired" || Boolean(now && contextExpires && now>=contextExpires);
  if(expired)return <p role="alert">{sent.error??(view.singleEmail?"Срок ссылки для входа истёк. Попросите организатора отправить новое приглашение.":"Срок текущей сессии приглашения истёк. Откройте письмо-приглашение снова.")}</p>;
  const wrong=view.wrongAccount || sent.phase==="wrong";
  if(wrong)return <div className="space-y-4"><p>Это приглашение предназначено для другого адреса: {view.maskedEmail}.</p><form action={switchAccount}><button className={button} disabled={switching}>Выйти и продолжить с адресом приглашения</button></form>{switched.error && <p role="alert">{switched.error}</p>}</div>;
  const accepted=sent.phase?sent.phase==="waiting" && sent.authRequestAccepted===true:view.phase==="waiting";
  const codeExpires=sent.expires??view.codeExpires;
  const waiting=accepted && !(now && codeExpires && now>=codeExpires);
  const sentAt=sent.sentAt??view.sentAt;
  const cooldown=sentAt?Math.max(0,Math.ceil((sentAt+60000-(now||sentAt))/1000)):0;
  const text=getMessages("ru").auth;
  return <div className="space-y-5">
    <div className="space-y-2"><h2 className="text-xl font-semibold">{view.company}</h2><p>{view.team}</p><p>{view.inviter} приглашает вас пройти командную диагностику.</p><p>Организатор видит статус прохождения, но не ваши индивидуальные ответы.</p></div>
    {waiting && <div className="space-y-3" role="status"><h2 className="text-xl font-semibold">Проверьте почту</h2><p>Письмо отправлено на {view.maskedEmail}. Проверьте входящие и спам.</p><p>Нажмите кнопку в письме, чтобы продолжить в этом же браузере.</p></div>}
    {accepted && !waiting && <p role="alert">Срок проверки письма истёк. Запросите письмо ещё раз, если сессия приглашения ещё действует.</p>}
    <form action={send} className="space-y-4">
      {Object.entries(policy.versions).map(([kind,version])=><input key={kind} type="hidden" name={`${kind}_version`} value={version}/>)}
      <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" name="data_processing_consent" required checked={consented} onChange={e=>setConsented(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-brand"/><span>{text.dataConsent}</span></label>
      <Link href={policy.dataUrl} className="block text-sm underline">{text.dataLink}</Link>
      {policy.temporary && <p className="text-xs text-muted">{text.temporaryLegal}</p>}
      <button disabled={sending||cooldown>0} className={button}>{sending?"Продолжаем…":view.matching?"Продолжить":accepted?"Отправить ещё раз":"Продолжить"}</button>
      {cooldown>0 && <p>Повторная отправка через {cooldown} сек.</p>}
    </form>
    {sent.error && <p role="alert">{sent.error}</p>}
  </div>;
}
