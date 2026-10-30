'use client';
import Link from 'next/link';
import {useEffect,useRef} from 'react';
let visitRequest:Promise<void>|null=null;
function ensureVisit(attribution:Record<string,string>={}){
 if(visitRequest)return visitRequest;
 let host='';try{host=new URL(document.referrer).hostname;}catch{}
 const firstTouch={landing_variant:'v25',...(host?{referrer_host:host}:{}),...attribution};
 visitRequest=fetch('/api/acquisition/visit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(firstTouch),keepalive:true,signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw Error('visit_unavailable');}).catch(()=>{visitRequest=null;});
 return visitRequest;
}
export function VisitTracker({attribution}:{attribution:Record<string,string>}){
 const sent=useRef(false);useEffect(()=>{if(sent.current)return;sent.current=true;void ensureVisit(attribution);},[attribution]);return null;
}
async function trackCTA(href:string){
 try{
  // The visit cookie must exist before recording the CTA, but neither request
  // should delay the Link's normal navigation.
  await ensureVisit(Object.fromEntries(new URL(href,location.origin).searchParams));
  await fetch('/api/acquisition/cta',{method:'POST',headers:{'content-type':'application/json'},body:'{}',keepalive:true,signal:AbortSignal.timeout(3000)});
 }catch{}
}
export function AcquisitionCTA({href,children}:{href:string;children:React.ReactNode}){
 return <Link href={href} onClick={e=>{
  if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0)return;
  void trackCTA(href);
 }} className="inline-flex min-h-13 w-full items-center justify-center rounded-xl bg-brand px-6 py-4 text-center text-sm font-semibold text-white hover:bg-brand-dark sm:w-auto">{children}</Link>;
}
export function MilestoneView({name,companyId,diagnosticId=null,surface='individual_report'}:{name:'individual_report_viewed'|'advanced_offer_viewed'|'team_explainer_viewed';companyId:string;diagnosticId?:string|null;surface?:string}){
 const once=useRef(false);useEffect(()=>{if(once.current)return;once.current=true;void fetch('/api/acquisition/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,companyId,diagnosticId,surface}),keepalive:true});},[name,companyId,diagnosticId,surface]);return null;
}
