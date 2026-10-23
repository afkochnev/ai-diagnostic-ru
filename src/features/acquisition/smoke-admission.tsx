'use client';
import {useEffect,useRef,useState} from 'react';
export function SmokeAdmission(){
 const started=useRef(false),[failed,setFailed]=useState(false);
 useEffect(()=>{
  if(started.current)return;started.current=true;
  const admission=new URLSearchParams(window.location.hash.slice(1)).get('admission');
  window.history.replaceState(null,'',window.location.pathname);
  async function enter(){
   if(!admission)throw Error('missing_admission');
   const response=await fetch('/api/acquisition/smoke-admission',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({admission})});
   if(!response.ok)throw Error('invalid_admission');
   window.location.replace('/ru/free');
  }
  void enter().catch(()=>setFailed(true));
 },[]);
 return <p role="status">{failed?'Ссылка недействительна или срок доступа истёк.':'Открываем диагностику…'}</p>;
}
