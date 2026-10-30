"use client";
import { useActionState, useState } from "react";
import { teamResultAction } from "@/server/team/actions";
import type { TeamActionState } from "@/server/team/contracts";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function TeamResultForm({ teamId,intent,label,previousReportId,invitedCount=0,completedCount=0 }: {invitedCount?:number;completedCount?:number;teamId:string;intent:"refresh"|"report"|"regenerate"|"close";label:string;previousReportId?:string}) {
  const [state,action,pending]=useActionState<TeamActionState,FormData>(teamResultAction,{});
  const router=useRouter();
  const [confirmClose,setConfirmClose]=useState(false);
  useEffect(()=>{if(state.status==="requested")router.refresh();},[state,router]);
  if(intent==="close"&&!confirmClose) return <button type="button" onClick={()=>setConfirmClose(true)} className="mt-4 rounded-lg border border-line px-4 py-3 font-semibold">{label}</button>;
  return <form action={action} className="mt-4"><input type="hidden" name="teamId" value={teamId} /><input type="hidden" name="intent" value={intent} />{previousReportId && <input type="hidden" name="previousReportId" value={previousReportId} />}
    {intent==="close"&&<div className="mb-4 rounded-xl bg-tint p-4"><p className="font-semibold">Завершить сбор ответов?</p><p className="mt-2 text-sm">Приглашены: {invitedCount}. Завершили: {completedCount}. Незавершённых: {Math.max(0,invitedCount-completedCount)}.</p><p className="mt-2 text-sm">После подтверждения участники не смогут сохранить или отправить ответы. Повторно открыть сбор нельзя.</p><button type="button" disabled={pending} onClick={()=>setConfirmClose(false)} className="mt-3 underline">Продолжить сбор</button></div>}
    <button disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-white hover:bg-brand-dark disabled:opacity-50">{pending ? "Выполняется…" : label}</button>
    {state.error && <p role="alert" className="mt-2">{state.error}</p>}{state.status==="requested" && <p role="status" className="mt-2">Запрос принят. Проверяем готовность автоматически.</p>}</form>;
}
