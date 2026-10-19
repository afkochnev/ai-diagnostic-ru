import { stageTokens,type Stage } from "./runtime";
import { foodtechRequestByteCaps } from "./request-budget";

/** Settle confirmed token usage conservatively; unresolved requests retain their
 * full liability. This is an approved-plan accounting policy, not an invoice. */
export function experimentAccounting(runs:{externalCalls:number;attempts:{stage:string;reservedUSD:number;cell?:string}[];receipts:{stage:string;reservedUSD:number;cell?:string;model:string;effort:string;inputTokens:number;outputTokens:number;requestId:string|null}[]}[]){
 let calls=0,reservedUSD=0,upperUSD=0,unresolved=0;const ids=new Set<string>();
 for(const run of runs){
   if(run.externalCalls!==run.attempts.length||run.receipts.length>run.attempts.length)throw Error("quality_accounting_invalid");
   calls+=run.externalCalls;
   run.attempts.forEach((a,i)=>{
     if(!Number.isFinite(a.reservedUSD)||a.reservedUSD<=0)throw Error("quality_accounting_invalid");
     reservedUSD+=a.reservedUSD;const r=run.receipts[i],stage=a.stage as Stage;
     if(!r||r.stage!==a.stage||r.cell!==a.cell||r.reservedUSD!==a.reservedUSD||r.model!=="gpt-5.6-sol"||r.effort!=="medium"||!r.requestId||!Number.isInteger(r.inputTokens)||!Number.isInteger(r.outputTokens)||r.inputTokens<=0||r.outputTokens<=0){upperUSD+=a.reservedUSD;unresolved++;return;}
     const upper=(r.inputTokens*5+r.outputTokens*20)/1e6;
     if(ids.has(r.requestId)||!stageTokens[stage]||r.inputTokens>foodtechRequestByteCaps[stage]||r.outputTokens>stageTokens[stage]||upper>a.reservedUSD+1e-8)throw Error("quality_accounting_invalid");
     ids.add(r.requestId);upperUSD+=upper;
   });
 }
 return {calls,reservedUSD:Number(reservedUSD.toFixed(8)),upperUSD:Number(upperUSD.toFixed(8)),unresolved};
}
