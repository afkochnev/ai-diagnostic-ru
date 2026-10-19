import { it,expect,vi } from "vitest";
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,chmodSync,lstatSync,rmSync,realpathSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { qualityCase } from "../../scripts/fixtures/team-quality-cases";
import { authoredStageStubs } from "../../scripts/fixtures/team-quality-stage-stubs";
import { createStageCache,digest,verifyManifest,type CacheScope } from "@/server/team/quality/stage-cache";
import { runQualityVariant,type StageRequest } from "@/server/team/quality/runtime";
import { experimentAccounting } from "@/server/team/quality/experiment-accounting";
import { researchLedger,appendResearchJournal } from "@/server/team/quality/research-ledger";

const scope:CacheScope={sourceFingerprint:"a".repeat(64),codeSHA256:"b".repeat(64),model:"gpt-5.6-sol",effort:"medium"};
function area(){const root=realpathSync(mkdtempSync("/private/tmp/quality-cache-test-"));chmodSync(root,0o700);const a=join(root,"a"),b=join(root,"b");mkdirSync(a,{mode:0o700});mkdirSync(b,{mode:0o700});return {root,a,b,close:()=>rmSync(root,{recursive:true,force:true})};}
const request:StageRequest={stage:"extract",input:{groups:[{question_position:1,texts:["RAW_SOURCE_ALPHA","RAW_SOURCE_BETA"]}]},schema:z.strictObject({safe:z.string()}),maxOutputTokens:4000,deadline:Date.now()+60000};
it("stores only a checked result and hashes, with private modes; request order is not persisted",()=>{
 const t=area();try{
  const a=createStageCache(join(t.a,"checkpoints"),t.root,scope);a.save(request,{safe:"Проверенный производный результат."});const manifest=a.manifest(),entry=manifest.extract!;
  expect(lstatSync(entry.path).mode&0o777).toBe(0o600);expect(lstatSync(join(t.a,"checkpoints")).mode&0o777).toBe(0o700);
  expect(readFileSync(entry.path,"utf8")).not.toContain("RAW_SOURCE");
  const b=createStageCache(join(t.b,"checkpoints"),t.root,scope,manifest),changed=structuredClone(request.input) as {groups:{texts:string[]}[]};changed.groups[0].texts.reverse();
  expect(b.read({...request,input:changed})).toEqual({safe:"Проверенный производный результат."});
  expect((request.input as {groups:{texts:string[]}[]}).groups[0].texts).toEqual(["RAW_SOURCE_ALPHA","RAW_SOURCE_BETA"]);
 }finally{t.close();}
});
it("rejects changed source/code/request, altered file, unsafe permissions and non-prefix manifests",()=>{
 const t=area();try{
  const a=createStageCache(join(t.a,"checkpoints"),t.root,scope);a.save(request,{safe:"Проверенный результат."});const m=a.manifest();
  for(const changed of [{...scope,sourceFingerprint:"c".repeat(64)},{...scope,codeSHA256:"c".repeat(64)}]){
   const dir=join(t.b,digest(JSON.stringify(changed)).slice(0,8));const b=createStageCache(dir,t.root,changed,m);expect(()=>b.read(request)).toThrow("quality_checkpoint_rejected");
  }
  const b=createStageCache(join(t.b,"normal"),t.root,scope,m);expect(()=>b.read({...request,input:{groups:[]}})).toThrow("quality_checkpoint_rejected");
  expect(()=>verifyManifest({core:m.extract},t.root)).toThrow("quality_checkpoint_rejected");
  chmodSync(m.extract!.path,0o640);expect(()=>verifyManifest(m,t.root)).toThrow("quality_checkpoint_rejected");chmodSync(m.extract!.path,0o600);
  writeFileSync(m.extract!.path,"{}");expect(()=>verifyManifest(m,t.root)).toThrow("quality_checkpoint_rejected");
 }finally{t.close();}
});
it("replays four checked stages after a later failure, revalidates them and pays only for the remaining two",async()=>{
 const t=area();try{
  const f=qualityCase("production"),stubs=authoredStageStubs(f),a=createStageCache(join(t.a,"checkpoints"),t.root,scope),requests=new Map<string,StageRequest>();
  await expect(runQualityVariant({...f,variant:"C",researchComparison:true,maxPrivacyRepairs:0,maxCalls:12,deadline:Date.now()+60000,databaseValidate:async()=>{},
   checkedStage:async(stage,value)=>a.save(requests.get(stage)!,value),call:async r=>{requests.set(r.stage,r);return r.stage==="dynamics"?{...stubs.dynamics as object,alignment:[f.corpus.answers[0].text]}:structuredClone(stubs[r.stage]);}})).rejects.toThrow("team_privacy_rejected");
  expect(Object.keys(a.manifest())).toEqual(["extract","diagnose","program","core"]);
  const b=createStageCache(join(t.b,"checkpoints"),t.root,scope,a.manifest()),paid:string[]=[],databaseValidate=vi.fn(async()=>{});
  const resumed=await runQualityVariant({...f,variant:"C",researchComparison:true,maxPrivacyRepairs:2,maxCalls:12,deadline:Date.now()+60000,databaseValidate,
   call:async r=>{const cached=b.read(r);if(cached!==undefined)return cached;paid.push(r.stage);return structuredClone(stubs[r.stage]);}});
  expect(paid).toEqual(["dynamics","review"]);expect(databaseValidate).toHaveBeenCalledTimes(8);expect(resumed.status).toBe("owner_review_required");
  for(const entry of Object.values(a.manifest()))for(const answer of f.corpus.answers)expect(readFileSync(entry.path,"utf8")).not.toContain(answer.text);
 }finally{t.close();}
});
it("purges this run's copied payloads on quarantine without deleting its predecessor",()=>{
 const t=area();try{
  const a=createStageCache(join(t.a,"checkpoints"),t.root,scope);a.save(request,{safe:"Проверенный результат."});const b=createStageCache(join(t.b,"checkpoints"),t.root,scope,a.manifest());b.save(request,b.read(request));b.quarantine();
  expect(b.manifest()).toEqual({});expect(verifyManifest(a.manifest(),t.root)).toEqual(["extract"]);
 }finally{t.close();}
});
it("reconciles confirmed receipts at conservative prices and reserves unresolved calls in full",()=>{
 const a={stage:"extract",reservedUSD:0.6},r={...a,model:"gpt-5.6-sol",effort:"medium",inputTokens:10000,outputTokens:2000,requestId:"request-a"};
 expect(experimentAccounting([{externalCalls:2,attempts:[a,{stage:"diagnose",reservedUSD:0.4}],receipts:[r]}])).toEqual({calls:2,reservedUSD:1,upperUSD:0.49,unresolved:1});
 expect(experimentAccounting([{externalCalls:1,attempts:[a],receipts:[{...r,inputTokens:0}]}]).upperUSD).toBe(0.6);
 expect(()=>experimentAccounting([{externalCalls:2,attempts:[a,a],receipts:[r,r]}])).toThrow("quality_accounting_invalid");
});
it("counts all real branches, ignores simulations, and blocks incomplete or inconsistent accounting",()=>{
 const t=area();try{
  const ids=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"],a={stage:"extract",ordinal:1,reservedUSD:0.6};
  for(const id of ids){
   const dir=join(t.root,id);mkdirSync(dir,{mode:0o700});appendResearchJournal(join(dir,"run-journal.jsonl"),{kind:"scope",runId:id,simulated:false});appendResearchJournal(join(dir,"run-journal.jsonl"),{kind:"attempt",...a});
   writeFileSync(join(dir,"run-metadata.json"),JSON.stringify({status:"STOPPED",simulated:false,model:"gpt-5.6-sol",effort:"medium",sourceFingerprint:scope.sourceFingerprint,externalCalls:1,attempts:[a],receipts:[]}),{mode:0o600});
  }
  const sim=join(t.root,"33333333-3333-4333-8333-333333333333");mkdirSync(sim,{mode:0o700});writeFileSync(join(sim,"run-metadata.json"),JSON.stringify({simulated:true}),{mode:0o600});
  const records=researchLedger(t.root,scope.sourceFingerprint);expect(records).toHaveLength(2);expect(experimentAccounting(records.map(r=>JSON.parse(r.bytes.toString()))).calls).toBe(2);
  const first=join(t.root,ids[0],"run-journal.jsonl");appendResearchJournal(first,{kind:"attempt",stage:"diagnose",ordinal:2,reservedUSD:0.4});
  expect(()=>researchLedger(t.root,scope.sourceFingerprint)).toThrow("quality_incomplete_run_requires_audit");
 }finally{t.close();}
});
