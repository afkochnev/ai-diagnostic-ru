"use client";
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { sendTeamCodeAction, verifyTeamCodeAction } from "@/server/team/passwordless-actions";
import { getMessages } from "@/i18n/messages";
export type TeamEntryPolicy = { versions: Record<string,string>; temporary: boolean; dataUrl: string; marketingUrl: string };
export function TeamPasswordless({policy,pendingCode}:{policy:TeamEntryPolicy;pendingCode:boolean}) {
  const [sent,send,sending]=useActionState(sendTeamCodeAction,{});
  const [verified,verify,verifying]=useActionState(verifyTeamCodeAction,{});
  const [cooldown,setCooldown]=useState(0);
  const text=getMessages("ru").auth;
  useEffect(()=>{
    if(cooldown<=0) return;
    const timer=window.setInterval(()=>setCooldown(value=>Math.max(0,value-1)),1000);
    return ()=>window.clearInterval(timer);
  },[cooldown]);
  const hasCode=Boolean(sent.sent || pendingCode);
  return <div className="space-y-5">
    <h2 className="text-xl font-semibold">Войти без пароля</h2>
    <p>Отправим одноразовый код на email, указанный в приглашении. Если вы впервые участвуете, учётная запись будет создана автоматически. Пароль и профиль компании не нужны.</p>
    <form action={send} onSubmit={()=>setCooldown(60)} className="space-y-4">
      {Object.entries(policy.versions).map(([kind,version])=><input key={kind} type="hidden" name={`${kind}_version`} value={version}/>)}
      <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" name="data_processing_consent" required className="mt-1 h-5 w-5 shrink-0 accent-brand"/><span>{text.dataConsent}</span></label>
      <Link href={policy.dataUrl} className="block text-sm underline">{text.dataLink}</Link>
      {policy.temporary && <p className="text-xs text-muted">{text.temporaryLegal}</p>}
      <button disabled={sending || verifying || cooldown>0} className="min-h-12 rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-60">{sending?"Отправляем код…":hasCode?"Отправить код ещё раз":"Получить код на email"}</button>
      {cooldown>0 && <p role="status">Повторная отправка через {cooldown} сек.</p>}
    </form>
    {hasCode && <div className="space-y-4">
      <p role="status">Код отправлен на email из приглашения. Введите код из последнего письма в этом окне. Проверьте также папку «Спам».</p>
      <form action={verify} className="space-y-4">
        <label className="block font-medium">Код из письма<input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required className="mt-2 block min-h-12 w-full rounded-xl border border-line px-3 py-3"/></label>
        <button disabled={sending || verifying} className="min-h-12 rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-60">{verifying?"Проверяем код…":"Войти и открыть анкету"}</button>
      </form>
    </div>}
    {(verified.error || sent.error) && <p role="alert">{verified.error || sent.error}</p>}
  </div>;
}
