"use client";
import {useEffect,useRef,useState} from "react";
import {confirmTeamEmailAction,type TeamPasswordlessState} from "@/server/team/passwordless-actions";
export function TeamEmailConfirm(){
  const started=useRef(false),[result,setResult]=useState<TeamPasswordlessState>({});
  useEffect(()=>{
    if(started.current)return;started.current=true;
    const fragment=new URLSearchParams(window.location.hash.slice(1)),form=new FormData();
    form.set("token_hash",fragment.get("token_hash")??"");form.set("type",fragment.get("type")??"");
    window.history.replaceState(null,"",window.location.pathname);
    void confirmTeamEmailAction({},form).then(setResult).catch(()=>setResult({error:"Не удалось продолжить. Откройте исходное письмо-приглашение в этом браузере."}));
  },[]);
  return result.error?<p role="alert">{result.error}</p>:<p role="status">Подтверждаем email и открываем вашу анкету…</p>;
}
