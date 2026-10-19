import { readdirSync,readFileSync,existsSync,lstatSync,openSync,writeSync,fsyncSync,closeSync,fstatSync,constants } from "node:fs";
import { join } from "node:path";
import type { CallReceipt } from "./openai-port";

/** Count every terminal real run, independent of the selected cache ancestry. */
export function researchLedger(root:string,fingerprint:string){
 const files:{path:string;bytes:Buffer}[]=[];if(!existsSync(root))return files;
 for(const name of readdirSync(root).sort()){
  if(!/^[0-9a-f-]{36}$/.test(name))continue;
  const dir=join(root,name),s=lstatSync(dir);if(s.isSymbolicLink()||!s.isDirectory())throw Error("quality_history_invalid");
  const path=join(dir,"run-metadata.json");
  if(!existsSync(path)){
   const scope=join(dir,"run-scope.json");if(existsSync(scope)&&JSON.parse(readFileSync(scope,"utf8")).simulated===true)continue;
   throw Error("quality_incomplete_run_requires_audit");
  }
  const bytes=readFileSync(path),meta=JSON.parse(bytes.toString());if(meta.simulated===true)continue;
  if(meta.simulated!==false||meta.model!=="gpt-5.6-sol"||meta.effort!=="medium"||meta.sourceFingerprint!==fingerprint||!["STOPPED","OWNER_REVIEW_REQUIRED"].includes(meta.status))throw Error("quality_history_invalid");
  const journal=join(dir,"run-journal.jsonl");if(!existsSync(journal))throw Error("quality_incomplete_run_requires_audit");
  const rows=readFileSync(journal,"utf8").trim().split("\n").map(s=>JSON.parse(s));
  const payload=(kind:string)=>rows.filter(r=>r.kind===kind).map(({kind:ignored,...value})=>{void ignored;return value;});
  if(rows[0]?.kind!=="scope"||rows[0].simulated!==false||rows[0].runId!==name||JSON.stringify(payload("attempt"))!==JSON.stringify(meta.attempts)||JSON.stringify(payload("receipt"))!==JSON.stringify(meta.receipts))throw Error("quality_incomplete_run_requires_audit");
  files.push({path,bytes});
 }
 return files;
}
type JournalEntry={kind:"scope";runId:string;simulated:boolean}|{kind:"attempt";stage:string;ordinal:number;reservedUSD:number}|({kind:"receipt"}&CallReceipt);
/** Durable, whitelisted accounting metadata before a paid send and after receipt.
 * No prompt, response text, source, key or arbitrary caller fields are serialized. */
export function appendResearchJournal(path:string,entry:JournalEntry){
 const value=entry.kind==="scope"?{kind:entry.kind,runId:entry.runId,simulated:entry.simulated}:entry.kind==="attempt"?{kind:entry.kind,stage:entry.stage,ordinal:entry.ordinal,reservedUSD:entry.reservedUSD}:{kind:entry.kind,stage:entry.stage,requestId:entry.requestId,model:entry.model,effort:entry.effort,elapsedMs:entry.elapsedMs,inputTokens:entry.inputTokens,outputTokens:entry.outputTokens,reservedUSD:entry.reservedUSD};
 const fd=openSync(path,constants.O_APPEND|constants.O_CREAT|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
 try{const stat=fstatSync(fd);if(!stat.isFile()||(stat.mode&0o077)!==0||stat.uid!==process.getuid?.())throw Error("quality_journal_invalid");const text=JSON.stringify(value)+"\n";if(writeSync(fd,text)!==Buffer.byteLength(text))throw Error("quality_journal_invalid");fsyncSync(fd);}finally{closeSync(fd);}
}
