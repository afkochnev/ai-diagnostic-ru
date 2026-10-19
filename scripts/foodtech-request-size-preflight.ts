import { readFileSync,writeFileSync } from "node:fs";
import { resolve,sep } from "node:path";
import { createHash } from "node:crypto";
import { privateManagementQuery,foodtechSource } from "./foodtech-quality-source";
import { authoredStageStubs } from "./fixtures/team-quality-stage-stubs";
import { qualityCase } from "./fixtures/team-quality-cases";
import { approvedRequestBody } from "../src/server/team/quality/openai-port";
import { foodtechRequestByteCaps } from "../src/server/team/quality/request-budget";
import { runQualityVariant,stageTokens,type StageRequest } from "../src/server/team/quality/runtime";
import { emptySynthesis,buildDossier } from "../src/server/team/quality/dossier";
import { mainTeamReportInputV3,teamReportV3Schema,teamSynthesisV3Schema } from "../src/server/team/report-v3-contracts";

/** Read-only real-source sizing; authored outputs, no key/client/API calls or raw files. */
async function main(){
 const transport=privateManagementQuery();
 try{
  const expected=JSON.parse(readFileSync("../artifacts/v22c4-team-report-quality/foodtech-readonly-baseline.json","utf8"));
  const source=foodtechSource(transport.query,expected),f=await source.load(),stubs=authoredStageStubs({...f,id:"production"} as ReturnType<typeof qualityCase>);
  if(!buildDossier(f.aggregates,f.qualitative).known.has("context.main_goals"))(stubs.diagnose as {diagnoses:{goal_ref:string|null}[]}).diagnoses[0].goal_ref=null;
  const rows:{variant:string;stage:string;bytes:number;limit:number;headroom:number}[]=[];
  function measure(request:StageRequest,variant:string){
   const body=approvedRequestBody(request,"gpt-5.6-sol","medium"),bytes=Buffer.byteLength(JSON.stringify(body)),limit=foodtechRequestByteCaps[request.stage];
   let enumEntries=0;const scan=(v:unknown)=>{if(v&&typeof v==="object"){if("enum" in v)enumEntries+=(v as {enum:unknown[]}).enum.length;for(const child of Object.values(v))scan(child);}};scan(body.text.format.schema);
   if(bytes>limit||enumEntries>1000)throw Error("foodtech_size_preflight_failed");
   rows.push({variant,stage:request.stage,bytes,limit,headroom:limit-bytes});
  }
  const privacyPolicy=process.argv.includes("--privacy-policy=unattributed")?"unattributed":"strict";
 for(const variant of (privacyPolicy==="unattributed"?["C"]:["A","B","C"]) as ("A"|"B"|"C")[])await runQualityVariant({...f,corpus:{threshold:32,answers:[],identifiers:[]},variant,researchComparison:true,privacyPolicy,maxCalls:8,deadline:Date.now()+600000,databaseValidate:async()=>{},call:async request=>{measure(request,variant);return structuredClone(stubs[request.stage]);}});
  const stress=teamSynthesisV3Schema.parse({...emptySynthesis,themes:Array.from({length:8},(_,i)=>({title:"Проверка объёма",summary:"я".repeat(1800),question_position:f.qualitative.groups[i%4].question_position,response_count:3}))});
  measure({stage:"baseline_report",input:mainTeamReportInputV3(f.aggregates,stress),schema:teamReportV3Schema,maxOutputTokens:stageTokens.baseline_report,deadline:Date.now()+600000},"A_SYNTHESIS_SIZE_STRESS_AUTHORED");
  await source.metadata();
  const checkedFiles=["scripts/foodtech-request-size-preflight.ts","scripts/run-foodtech-checkpoint-research.ts","src/server/team/quality/openai-port.ts","src/server/team/quality/request-budget.ts","src/server/team/quality/runtime.ts","src/server/team/quality/stage-cache.ts","src/server/team/quality/experiment-accounting.ts","src/server/team/quality/research-ledger.ts","src/server/team/quality/guarded-repair.ts","scripts/fixtures/team-quality-stage-stubs.ts","src/server/team/quality/dossier.ts","src/server/team/quality/system-assessment.ts","src/server/team/quality/text-signals.ts","src/server/team/quality/prompts.ts","src/server/team/quality/privacy-policy.ts"];
  const code_sha256=Object.fromEntries(checkedFiles.map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
  const result={status:"ACTUAL_SOURCE_SERIALIZATION_PASS_AUTHORED_OUTPUTS_ONLY",external_AI_calls:0,mutations:0,credential_or_key_printed:false,privacyPolicy,all_normal_stages:privacyPolicy==="unattributed"?6:12,source_guard:"PASS",source_fingerprint:expected.fingerprint,code_sha256,rows,limitations:"Sizing uses authored intermediate outputs, not future AI responses. Actual response size is checked before every external request; oversized future output still stops without truncating evidence."};
  const chosen=process.argv.find(a=>a.startsWith("--output=")),output=chosen?resolve(chosen.slice(9)):resolve("../artifacts/v22c4-team-report-quality/foodtech-all-stage-size-preflight.json");
  if(!output.startsWith(resolve("../artifacts/v22c4-team-report-quality")+sep)||!output.endsWith(".json"))throw Error("quality_size_output_invalid");
  writeFileSync(output,JSON.stringify(result,null,2)+"\n",{mode:0o600,...chosen?{flag:"wx"}:{}});
  console.log(JSON.stringify({status:result.status,stages:result.all_normal_stages,stress_checks:1,external_AI_calls:0,mutations:0}));
 }finally{transport.close();}
}
void main().catch(()=>{console.error("FOODTECH_SIZE_PREFLIGHT_FAILED_NO_PAYLOAD");process.exitCode=1;});
