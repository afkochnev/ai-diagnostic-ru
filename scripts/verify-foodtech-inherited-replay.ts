import { readFileSync,writeFileSync,mkdirSync } from "node:fs";
import { resolve,join } from "node:path";
import { randomUUID } from "node:crypto";
import { foodtechSource,privateManagementQuery } from "./foodtech-quality-source";
import { pinOrigin,replayOrigin } from "./foodtech-checkpoint-origin";
import { createStageCache,digest } from "../src/server/team/quality/stage-cache";
import { runQualityVariant,type StageRequest } from "../src/server/team/quality/runtime";
import { approvedRequestBody } from "../src/server/team/quality/openai-port";
import { foodtechRequestByteCaps } from "../src/server/team/quality/request-budget";
import { authoredStageStubs } from "./fixtures/team-quality-stage-stubs";
import type { qualityCase } from "./fixtures/team-quality-cases";
const base=resolve("../artifacts/v22c4-team-report-quality"),root=join(base,"foodtech-checkpoint-runs"),originDir=join(root,"4831628f-e66f-4d68-89d2-18b61034e29a");
async function main(){
 const expected=JSON.parse(readFileSync(join(base,"foodtech-readonly-baseline.json"),"utf8")),meta=JSON.parse(readFileSync(join(originDir,"run-metadata.json"),"utf8"));
 const pin=pinOrigin(originDir,root,meta.checkpoints),origin=replayOrigin(pin,root,meta.checkpoints),work=join(base,"inherited-replay-check-"+randomUUID());mkdirSync(work,{mode:0o700});
 const cache=createStageCache(join(work,"checked"),root,{sourceFingerprint:expected.fingerprint,codeSHA256:"0".repeat(64),model:"gpt-5.6-sol",effort:"medium"},meta.checkpoints,origin);
 const transport=privateManagementQuery();
 try{
  const source=foodtechSource(transport.query,expected),f=await source.load(),stubs=authoredStageStubs({...f,id:"production"} as ReturnType<typeof qualityCase>);
  const core=stubs.core as {content:{manageability_index_text:{refs:string[]}}};core.content.manageability_index_text.refs=f.aggregates.blocks.map(b=>`block.${b.position}.mean`);
  const replayed:string[]=[],remaining:string[]=[],rows:unknown[]=[];
  await runQualityVariant({...f,variant:"C",researchComparison:true,privacyPolicy:"unattributed",editorialSystemText:true,maxPrivacyRepairs:3,maxCalls:12,deadline:Date.now()+600000,databaseValidate:source.validateUnattributed,call:async(request:StageRequest)=>{
   const reused=cache.read(request);if(reused!==undefined){replayed.push(request.stage);return reused;}
   remaining.push(request.stage);const body=approvedRequestBody(request,"gpt-5.6-sol","medium"),bytes=Buffer.byteLength(JSON.stringify(body)),limit=foodtechRequestByteCaps[request.stage];
   let enums=0;function scan(v:unknown){if(v&&typeof v==="object"){if("enum" in v)enums+=(v as {enum:unknown[]}).enum.length;for(const item of Object.values(v))scan(item);}}scan(body.text.format.schema);
   if(bytes>limit||enums>1000)throw Error("quality_size_preflight_required");rows.push({stage:request.stage,bytes,limit,enumEntries:enums});return structuredClone(stubs[request.stage]);
  }});
  if(replayed.join(",")!=="extract,diagnose,program"||remaining.join(",")!=="core,dynamics,review")throw Error("quality_replay_invalid");await source.metadata();
  const oldPlan=JSON.parse(readFileSync(join(base,"foodtech-unattributed-checkpoint-plan.json"),"utf8"));
  const files=["scripts/verify-foodtech-inherited-replay.ts","scripts/foodtech-checkpoint-origin.ts","scripts/run-foodtech-checkpoint-research.ts",...Object.keys(oldPlan.source_files)];
  const newFiles=["src/server/team/quality/numeric-proposals.ts","src/server/team/quality/editorial-style.ts"];
  const code_sha256=Object.fromEntries([...new Set([...files,...newFiles])].sort().map(p=>[p,digest(readFileSync(p))]));
  const result={status:"ACTUAL_SOURCE_SERIALIZATION_PASS_AUTHORED_OUTPUTS_ONLY",privacyPolicy:"unattributed",source_fingerprint:expected.fingerprint,source_guard:"PASS",external_AI_calls:0,mutations:0,origin:pin,replayed,remaining,rows,code_sha256,limitations:"Three real saved stages revalidated, remaining outputs authored. Not AI quality acceptance; future response sizes still checked before each request."};
  const chosen=process.argv.find(a=>a.startsWith("--output=")),output=chosen?resolve(chosen.slice(9)):join(base,"foodtech-numeric-resume-size-proof.json");if(!output.startsWith(base+"/")||!output.endsWith(".json"))throw Error("quality_size_preflight_required");
  writeFileSync(output,JSON.stringify(result,null,2)+"\n",{mode:0o600,flag:"wx"});console.log(JSON.stringify({status:result.status,replayed,remaining,external_AI_calls:0}));
 }finally{transport.close();}
}
void main().catch(()=>{console.error("INHERITED_REPLAY_CHECK_FAILED_NO_PAYLOAD");process.exitCode=1;});
