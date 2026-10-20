import { mkdirSync,writeFileSync } from "node:fs";
import { resolve,join } from "node:path";
import { randomUUID } from "node:crypto";
import { createQualityDatabase } from "./quality-local-db";
import { qualityCase } from "./fixtures/team-quality-cases";
import { authoredStageStubs } from "./fixtures/team-quality-stage-stubs";
import { createStageCache,digest,type CacheScope } from "../src/server/team/quality/stage-cache";
import { runQualityVariant,type StageRequest } from "../src/server/team/quality/runtime";

async function main(){
 const root=resolve("../artifacts/v22c4-team-report-quality/checkpoint-offline-replay-"+randomUUID());mkdirSync(root,{mode:0o700});
 const db=createQualityDatabase(),f=qualityCase("production"),stubs=authoredStageStubs(f),validate=db.load(f);
 const scope:CacheScope={sourceFingerprint:digest(JSON.stringify(f.aggregates)),codeSHA256:"b".repeat(64),model:"gpt-5.6-sol",effort:"medium"};
 try{
  const a=createStageCache(join(root,"checked"),root,scope),requests=new Map<string,StageRequest>();let stopped=false;
  try{await runQualityVariant({...f,variant:"C",researchComparison:true,maxPrivacyRepairs:0,maxCalls:12,deadline:Date.now()+600000,databaseValidate:validate,checkedStage:async(s,v)=>a.save(requests.get(s)!,v),call:async r=>{requests.set(r.stage,r);return r.stage==="dynamics"?{...stubs.dynamics as object,alignment:[f.corpus.answers[0].text]}:structuredClone(stubs[r.stage]);}});}catch(e){stopped=e instanceof Error&&e.message==="team_privacy_rejected";}
  if(!stopped||Object.keys(a.manifest()).join(",")!=="extract,diagnose,program,core")throw Error();
  const b=createStageCache(join(root,"replayed"),root,scope,a.manifest()),remaining:string[]=[];let validations=0;
  const replayed=await runQualityVariant({...f,variant:"C",researchComparison:true,maxPrivacyRepairs:2,maxCalls:12,deadline:Date.now()+600000,databaseValidate:async v=>{validations++;await validate(v);},call:async r=>{const value=b.read(r);if(value!==undefined)return value;remaining.push(r.stage);return structuredClone(stubs[r.stage]);}});
  const fresh=await runQualityVariant({...f,variant:"C",researchComparison:true,maxPrivacyRepairs:2,maxCalls:12,deadline:Date.now()+600000,databaseValidate:validate,call:async r=>structuredClone(stubs[r.stage])});
  if(remaining.join(",")!=="dynamics,review"||validations!==8||digest(JSON.stringify(replayed.report))!==digest(JSON.stringify(fresh.report)))throw Error();
  const result={status:"ISOLATED_DB_CHECKPOINT_REPLAY_PASS_MECHANICS_ONLY",external_AI_calls:0,checked_stages:4,replayed_stages:4,remaining_authored_calls:remaining,unchanged_DB_validator:db.fingerprint,revalidation_calls:validations,same_report_as_fresh_authored_run:true,owner_acceptance:"NOT_MEASURED"};
  writeFileSync(join(root,"verification.json"),JSON.stringify(result,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({...result,output:root}));
 }finally{db.close();}
}
void main().catch(()=>{console.error("CHECKPOINT_REPLAY_VERIFICATION_FAILED_NO_PAYLOAD");process.exitCode=1;});
