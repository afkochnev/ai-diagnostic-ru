"use client";
import { useActionState } from "react";
import { teamResultAction } from "@/server/team/actions";
import type { TeamActionState } from "@/server/team/contracts";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function TeamResultForm({ teamId,intent,label }: {teamId:string;intent:"refresh"|"report"|"close";label:string}) {
  const [state,action,pending]=useActionState<TeamActionState,FormData>(teamResultAction,{});
  const router=useRouter();
  useEffect(()=>{if(state.status==="requested")router.refresh();},[state,router]);
  return <form action={action} className="mt-4"><input type="hidden" name="teamId" value={teamId} /><input type="hidden" name="intent" value={intent} />
    <button disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-white hover:bg-brand-dark disabled:opacity-50">{pending ? "Выполняется…" : label}</button>
    {state.error && <p role="alert" className="mt-2">{state.error}</p>}{state.status==="requested" && <p role="status" className="mt-2">Запрос принят. Проверяем готовность автоматически.</p>}</form>;
}
