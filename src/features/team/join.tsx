"use client";
import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import {useRouter} from "next/navigation";
import {prepareTeamInvitationAction} from "@/server/team/actions";
import {invitationToken} from "@/server/team/contracts";
import type {TeamEntryView} from "@/server/team/entry-context";
import {TeamPasswordless,type TeamEntryPolicy} from "./passwordless";
function subscribe(listener:()=>void){window.addEventListener("hashchange",listener);return()=>window.removeEventListener("hashchange",listener);}
export function TeamJoin({view,policy}:{view:TeamEntryView;policy:TeamEntryPolicy}){
  const fragment=useSyncExternalStore(subscribe,()=>window.location.hash,()=>"");
  const router=useRouter(),started=useRef<string|null>(null),[error,setError]=useState("");
  const params=new URLSearchParams(fragment.slice(1)),raw=params.get("invitation"),hasLink=Boolean(raw);
  useEffect(()=>{
    if(!raw || started.current===raw)return;
    started.current=raw;
    const parameters=new URLSearchParams(fragment.slice(1));
    const form=new FormData();form.set("token",raw);form.set("context",parameters.get("context")??"");form.set("auth",parameters.get("auth")??"");
    window.history.replaceState(null,"",window.location.pathname);
    if(!invitationToken.safeParse(raw).success){Promise.resolve().then(()=>setError("Приглашение недоступно. Откройте исходное письмо-приглашение."));return;}
    void prepareTeamInvitationAction({},form).then(result=>{if(result.error)setError(result.error);else router.refresh();}).catch(()=>setError("Не удалось открыть приглашение. Откройте исходное письмо-приглашение снова."));
  },[raw,fragment,router]);
  if(error)return <p role="alert">{error}</p>;
  if(hasLink)return <p role="status">Открываем приглашение…</p>;
  return <TeamPasswordless key={view.flowId??"expired"} view={view} policy={policy}/>;
}
