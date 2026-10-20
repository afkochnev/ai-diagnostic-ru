import { readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync } from "node:fs";
import { resolve,join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash,randomInt,randomUUID } from "node:crypto";
import { caseIds,qualityCase } from "./fixtures/team-quality-cases";
import { authoredStageStubs } from "./fixtures/team-quality-stage-stubs";
import { createQualityDatabase } from "./quality-local-db";
import { runQualityVariant,normalCalls,stageTokens,type Variant, type SafeEvent } from "../src/server/team/quality/runtime";
import { createApprovedPort,type CallReceipt } from "../src/server/team/quality/openai-port";
import { blindReviewHtml } from "../src/server/team/quality/blind-review";
import { QualityReferenceError,QualityCriticRejection,type Review } from "../src/server/team/quality/contracts";
import { consumePrivateKey } from "../src/server/team/quality/private-key";

const artifacts=resolve("../artifacts/v22c4-team-report-quality"),keyPath="/private/tmp/aca-v22c4-quality/OPENAI_API_KEY.txt";
const hashes=()=>{
  const files=[...readdirSync("src/server/team/quality").filter(n=>n.endsWith(".ts")).map(n=>"src/server/team/quality/"+n),
    "scripts/run-quality-comparison.ts","scripts/quality-local-db.ts","scripts/fixtures/team-quality-cases.ts",
    "src/server/team/report-v3-provider.ts","src/server/team/report-v3-contracts.ts","src/server/team/report-v2-contracts.ts","src/server/team/synthesis-privacy.ts",
    "TEAM_REPORT_PROMPT_RU_3.md","TEAM_SYNTHESIS_PROMPT_RU_3.md","supabase/migrations/20261018105321_rich_team_ai_report_v2.sql"];
  return Object.fromEntries(files.sort().map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
};
const save=(p:string,value:unknown)=>writeFileSync(p,JSON.stringify(value,null,2)+"\n",{mode:0o600,flag:"wx"});
function priorRun(){
  const path=join(artifacts,"real-comparison/run-metadata.json"),raw=readFileSync(path),m=JSON.parse(raw.toString());
  if(m.status!=="STOPPED"||m.runId!=="ea26e0fb-a0eb-4709-8fa4-394e13bae15e"||m.externalCalls!==2||m.completedCells!==0||m.failureCode!=="quality_reference_invalid")throw new Error("quality_prior_run_changed");
  return {metadata_path:path,sha256:createHash("sha256").update(raw).digest("hex"),external_calls:2,reserved_USD:0.668005};
}
function preparePlan(retry=false){
  const plan={status:"PREPARED_REQUIRES_EXPLICIT_APPROVAL",date:"2026-10-19",run_id:randomUUID(),commit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
    source_files:hashes(),model:"gpt-5.6-sol",reasoning_effort:"medium",cases:[...caseIds],variants:["A","B","C"],
    normal_calls_per_case:normalCalls,maximum_external_calls:retry?46:48,maximum_USD:retry?34.25:34.92,price_verification_date:"2026-10-19",pricing_URL:"https://developers.openai.com/api/docs/models/gpt-5.6-sol",
    price_assumptions:{input_USD_per_million:5,output_USD_per_million:20,input_utf8_bytes_as_token_upper_bound:true,maximum_request_bytes:120000},stage_output_caps:stageTokens,
    global_deadline_minutes:120,cell_deadline_minutes:30,call_timeout_seconds:180,SDK_retries:0,maximum_privacy_repair_calls_per_cell:2,repair_rounds_per_stage:1,editorial_regeneration_calls:0,automatic_retries:0,
    key_path:keyPath,privacy:"Unchanged local+exact DB validator; shuffled authored synthetic texts only in extraction/synthesis; all subsequent stages raw-free; combined report rechecked.",
    storage:"Only approved final cells, safe metadata and local+DB privacy-validated critic diagnostics on quality rejection (no rejected report); inputs/unvalidated outputs remain in process pipes/memory; private key unlinked on load; process exits.",
    scope:"Local networkless disposable PostgreSQL and OpenAI Responses only. No staging mutations, migrations, deploys, env changes, accounts, participants, emails, real FoodTech data or production.",
    stop:"Any provider/schema/reference/numeric/privacy/critic failure, source hash mismatch, budget/deadline: stop entire run, no retry; already validated results preserved but no owner quality acceptance.",
    output_directory:join(artifacts,retry?"real-comparison-reference-retry":"real-comparison"),
    previous_run:retry?priorRun():null,
    change:retry?"Inline mandatory provenance constrained to existing refs; paths derived locally; safe reference failure reason; no weakening of privacy/numeric/owner gates.":null,
    aggregate_limits_with_previous_run:retry?{maximum_external_calls:48,maximum_reserved_USD:34.918005}:null,
    owner_acceptance:"PENDING; author/critic PASS never accepts quality",approval_user_reply:null};
  save(join(artifacts,retry?"real-comparison-reference-retry-plan.json":"real-comparison-plan.json"),plan);console.log("Prepared plan. No external calls.");
}
async function run(simulated:boolean,planPath?:string,simulateCriticFailure=false){
  const plan=simulated?null:JSON.parse(readFileSync(resolve(planPath??""),"utf8"));
  if(!simulated){
    const retry=resolve(plan.output_directory)===join(artifacts,"real-comparison-reference-retry");
    if(retry&&JSON.stringify(plan.previous_run)!==JSON.stringify(priorRun()))throw new Error("quality_prior_run_changed");
    if(plan.status!=="APPROVED"||!plan.approval_user_reply||plan.model!=="gpt-5.6-sol"||plan.reasoning_effort!=="medium"||plan.maximum_external_calls!==(retry?46:48)||plan.maximum_USD!==(retry?34.25:34.92)||plan.date!==new Date().toISOString().slice(0,10)||plan.key_path!==keyPath||(!retry&&resolve(plan.output_directory)!==join(artifacts,"real-comparison"))||JSON.stringify(plan.source_files)!==JSON.stringify(hashes())||execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()!==plan.commit||execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim())throw new Error("quality_approval_required");
  }
  const out=simulated?join(artifacts,"simulation-"+randomUUID()):resolve(plan.output_directory);
  if(existsSync(out))throw new Error("quality_output_exists");mkdirSync(out,{mode:0o700});
  const receipts:(CallReceipt&{cell:string})[]=[],attempts:{stage:string;ordinal:number;reservedUSD:number;cell:string;at:string}[]=[],events:(SafeEvent&{cell:string;at:string})[]=[],mapping:{case:string;label:string;variant:Variant}[]=[];
  let currentCell="bootstrap";
  const db=createQualityDatabase();let key="",failure=false,completedCells=0,failureCode:string|null=null,failureDetail:QualityReferenceError["reason"]|null=null,rejectedReview:Review|null=null;
  try{
    // Instantiate and seed all exact DB gates before consuming the real private key.
    const cases=caseIds.map(id=>{const f=qualityCase(id);return {f,gate:db.load(f)};});
    if(!simulated){
      key=consumePrivateKey(keyPath);
    }
    const actual=simulated?null:createApprovedPort({apiKey:key,approved:true,model:"gpt-5.6-sol",effort:"medium",maxCalls:plan.maximum_external_calls,maxUSD:plan.maximum_USD,deadline:Date.now()+120*60000,
      attempt:r=>{attempts.push({...r,cell:currentCell,at:new Date().toISOString()});console.log(JSON.stringify({event:"external_call_sent",...r,cell:currentCell}));},receipt:r=>receipts.push({...r,cell:currentCell})});key="";
    for(const {f,gate} of cases){
      const variants:Variant[]=["A","B","C"];for(let i=variants.length-1;i>0;i--){const j=randomInt(i+1);[variants[i],variants[j]]=[variants[j],variants[i]];}
      const stubs=simulated?authoredStageStubs(f):null;
      if(stubs&&simulateCriticFailure)stubs.review={verdict:"fail",defects:[{path:"main_diagnosis",code:"unsupported",critical:true,reason:"Недостаточно оснований для указанного механизма.",required_change:"Обозначить проверяемую гипотезу."}]};
      for(let i=0;i<variants.length;i++){
        const variant=variants[i],label=f.id+"-"+String(i+1);
        currentCell=label;
        const result=await runQualityVariant({...f,variant,databaseValidate:gate,deadline:Date.now()+30*60000,maxCalls:normalCalls[variant]+2,emit:e=>events.push({...e,cell:label,at:new Date().toISOString()}),call:actual??(async r=>structuredClone(stubs![r.stage]))});
        writeFileSync(join(out,label+".html"),blindReviewHtml(result.report,label,String(f.aggregates.company_context.company_name),simulated),{mode:0o600,flag:"wx"});
        mapping.push({case:f.id,label,variant});completedCells++;
      }
    }
  }catch(error){failure=true;if(error instanceof QualityReferenceError)failureDetail=error.reason;if(error instanceof QualityCriticRejection)rejectedReview=error.review;const message=error instanceof Error?error.message:"";failureCode=["quality_stage_failed","quality_budget_exhausted","quality_reference_invalid","quality_dependency_invalid","quality_db_rejected","quality_private_key_guard","team_privacy_rejected","team_numeric_integrity","team_quality_rejected","team_qualitative_insufficient"].includes(message)?message:"quality_controller_stopped";}finally{
    key="";try{db.close();}catch{failure=true;}
    if(rejectedReview)save(join(out,"rejected-quality-review.json"),{status:"DIAGNOSTIC_ONLY_NOT_OWNER_ACCEPTANCE",cell:currentCell,privacy:"LOCAL_AND_DB_PASS",...rejectedReview});
    save(join(out,"private-mapping.json"),mapping);
    save(join(out,"run-metadata.json"),{status:failure?"STOPPED":simulated?"SIMULATION_MECHANICS_ONLY":"OWNER_REVIEW_REQUIRED",failureCode,failureDetail,qualityReview:rejectedReview?"rejected-quality-review.json":null,simulated,runId:plan?.run_id??null,model:simulated?"authored-stubs":"gpt-5.6-sol",effort:simulated?null:"medium",completedCells,attempts,receipts,events,externalCalls:attempts.length,validatorMD5:db.fingerprint,ownerAcceptance:"PENDING",noStagingMutations:true});
  }
  console.log(JSON.stringify({status:failure?"STOPPED":simulated?"SIMULATION_MECHANICS_ONLY":"OWNER_REVIEW_REQUIRED",completedCells,externalCalls:attempts.length,output:out}));
  if(failure)process.exitCode=1;
}
async function main(){const mode=process.argv[2];if(mode==="--prepare-plan")preparePlan();else if(mode==="--prepare-reference-retry-plan")preparePlan(true);else if(mode==="--simulate")await run(true);else if(mode==="--simulate-critic-failure")await run(true,undefined,true);else if(mode==="--approved-plan")await run(false,process.argv[3]);else throw new Error("quality_cli_usage");}
void main().catch(()=>{console.error("quality_controller_stopped; no payload details");process.exitCode=1;});
