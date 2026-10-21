'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
/** Bounded local-state polling; no provider calls or checkout generation. */
export function BillingPending({checkout}:{checkout:string}){
 const router=useRouter(),[seconds,setSeconds]=useState(0);
 useEffect(()=>{let active=true,busy=false;const start=Date.now();const timer=setInterval(async()=>{
 const elapsed=Math.floor((Date.now()-start)/1000);if(active)setSeconds(elapsed);
 if(elapsed>=60){clearInterval(timer);return;}if(elapsed%3!==0||busy)return;busy=true;
 try{const r=await fetch(`/api/billing/status?checkout=${encodeURIComponent(checkout)}`,{cache:'no-store'});if(r.ok){const data=await r.json();if(active&&!['created','pending'].includes(data.status)){clearInterval(timer);router.refresh();}}}catch{}finally{busy=false;}
 },1000);return()=>{active=false;clearInterval(timer);};},[checkout,router]);
 return <div className="mt-4"><p role="status">{seconds<60?`Проверяем оплату · прошло ${seconds} сек.`:'Оплата ещё обрабатывается. Обновите страницу через некоторое время.'}</p><p className="mt-3 text-muted">Подтверждение может прийти чуть позже. Повторять оплату сейчас не нужно.</p><button className="mt-4 rounded-xl border px-5 py-3" onClick={()=>router.refresh()}>Обновить статус</button></div>;
}
