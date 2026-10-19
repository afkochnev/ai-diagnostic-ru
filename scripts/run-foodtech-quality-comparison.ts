import { readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync } from "node:fs";
import { resolve,join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash,randomInt,randomUUID } from "node:crypto";
import { privateManagementQuery,foodtechSource,FOODTECH } from "./foodtech-quality-source";
import { runQualityVariant,stageTokens,type Variant,type SafeEvent } from "../src/server/team/quality/runtime";
import { createApprovedPort,type CallReceipt } from "../src/server/team/quality/openai-port";
import { consumePrivateKey } from "../src/server/team/quality/private-key";
import { QualityCriticRejection,QualityReferenceError } from "../src/server/team/quality/contracts";
import { blindReviewHtml } from "../src/server/team/quality/blind-review";
import { inspectTeamOutputPrivacy } from "../src/server/team/synthesis-privacy";
import { qualityCase } from "./fixtures/team-quality-cases";
import { authoredStageStubs } from "./fixtures/team-quality-stage-stubs";
import { createQualityDatabase } from "./quality-local-db";
import { buildDossier } from "../src/server/team/quality/dossier";
import { foodtechRequestByteCaps,QualityBudgetError } from "../src/server/team/quality/request-budget";
import { QualityRepairError } from "../src/server/team/quality/guarded-repair";

const base=resolve("../artifacts/v22c4-team-report-quality"),out=join(base,"foodtech-real-comparison"),planPath=join(base,"foodtech-real-comparison-plan.json"),keyPath="/private/tmp/aca-v22c4-quality/OPENAI_API_KEY.txt";
const baseline=()=>JSON.parse(readFileSync(join(base,"foodtech-readonly-baseline.json"),"utf8"));
const save=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value,null,2)+"\n",{mode:0o600,flag:"wx"});
const sources=()=>Object.fromEntries([...readdirSync("src/server/team/quality").filter(n=>n.endsWith(".ts")).map(n=>"src/server/team/quality/"+n),"scripts/run-foodtech-quality-comparison.ts","scripts/foodtech-quality-source.ts","scripts/foodtech-request-size-preflight.ts","scripts/fixtures/team-quality-cases.ts","scripts/fixtures/team-quality-stage-stubs.ts","scripts/quality-local-db.ts","scripts/sql/foodtech-quality-readiness.sql","src/server/team/report-v3-provider.ts","src/server/team/report-v3-contracts.ts","src/server/team/report-v2-contracts.ts","src/server/team/synthesis-privacy.ts","src/server/team/report-privacy.ts","src/server/team/synthesis-repair.ts","TEAM_REPORT_PROMPT_RU_3.md","TEAM_SYNTHESIS_PROMPT_RU_3.md"].sort().map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
const normal={A:3,B:3,C:6};
const bc=process.argv[2]?.includes("bc")??false,cOnly=process.argv[2]?.includes("c-only")??false,profile=cOnly?"c-only-repair":bc?"bc-privacy":"size-retry";
const retryPlanPath=join(base,`foodtech-real-comparison-${profile}-plan.json`),retryOut=join(base,`foodtech-real-comparison-${profile}`);
const retryCalls=cOnly?8:bc?12:17,retryRepairs=cOnly?2:bc?3:5;
function previousRun(){
 const bytes=readFileSync(join(out,"run-metadata.json")),v=JSON.parse(bytes.toString());if(v.status!=="STOPPED"||v.externalCalls!==1||v.cells.length||v.failureCode!=="quality_budget_exhausted")throw Error("foodtech_previous_run_mismatch");
 const buffers=[bytes],runs=[v];
 if(bc||cOnly){const b=readFileSync(join(base,"foodtech-real-comparison-size-retry/run-metadata.json")),r=JSON.parse(b.toString());if(r.status!=="STOPPED"||r.externalCalls!==5||r.cells.length||r.failureCode!=="team_quality_rejected")throw Error("foodtech_previous_run_mismatch");buffers.push(b);runs.push(r);}
 if(cOnly){const b=readFileSync(join(base,"foodtech-real-comparison-bc-privacy/run-metadata.json")),r=JSON.parse(b.toString());if(r.status!=="STOPPED"||r.externalCalls!==3||r.cells.length||r.failureCode!=="team_numeric_integrity")throw Error("foodtech_previous_run_mismatch");buffers.push(b);runs.push(r);}
 return {metadata_SHA256:createHash("sha256").update(Buffer.concat(buffers)).digest("hex"),external_calls:runs.reduce((n,r)=>n+r.externalCalls,0),reserved_USD:runs.flatMap(r=>r.attempts).reduce((sum:number,a:{reservedUSD:number})=>sum+a.reservedUSD,0)};
}
function sizePreflight(){const bytes=readFileSync(join(base,"foodtech-all-stage-size-preflight.json")),v=JSON.parse(bytes.toString());if(v.status!=="ACTUAL_SOURCE_SERIALIZATION_PASS_AUTHORED_OUTPUTS_ONLY"||v.all_normal_stages!==12||v.external_AI_calls!==0||v.source_fingerprint!==baseline().fingerprint)throw Error("foodtech_size_preflight_required");for(const [p,h] of Object.entries(v.code_sha256))if(createHash("sha256").update(readFileSync(p)).digest("hex")!==h)throw Error("foodtech_size_preflight_required");return createHash("sha256").update(bytes).digest("hex");}
function prepare(retry=false){
 const plan={status:"PREPARED_REQUIRES_EXPLICIT_APPROVAL",date:new Date().toISOString().slice(0,10),run_id:randomUUID(),commit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),source_files:sources(),source:baseline(),project:FOODTECH.project,
  model:"gpt-5.6-sol",reasoning_effort:"medium",variants:["A","B","C"],normal_calls:normal,normal_calls_total:12,maximum_external_calls:18,maximum_USD:13.14,
  pricing:{date:new Date().toISOString().slice(0,10),url:"https://developers.openai.com/api/docs/models/gpt-5.6-sol",input_USD_per_million:5,output_USD_per_million:20,input_UTF8_bytes_as_token_upper_bound:true,maximum_request_bytes:120000},stage_output_caps:stageTokens,
  deadlines:{global_minutes:90,cell_minutes:30,call_seconds:180,DB_request_seconds:15},SDK_retries:0,maximum_privacy_repair_calls_per_cell:2,repair_rounds_per_stage:1,editorial_regeneration_calls:0,
  data:"Existing FoodTech team under audit_1. One frozen read-only source; masked groups independently shuffled per question once and reused identically across A/B/C. Real text groups only to synthesis/extraction; private corpus never sent to OpenAI, repair, author or critic.",
  evaluation:"All variants have the same final critic. A preserves historical first two stages; B and C include full-system assessment. Private research candidates are not published or accepted reports. Non-numeric/non-privacy substantive critic defects are saved with the candidate as quality_failed and the next already planned variant runs once. Owner review and correction remain mandatory; no automatic quality acceptance.",
  hard_stop:"Any schema/reference/numeric/privacy/source/transport/provider/budget/deadline failure stops the entire experiment without retry. Critic numeric/privacy defects also hard-stop and the candidate is not saved. Already checked prior research candidates remain labelled unaccepted.",
  storage:"Only schema/reference/numeric/privacy-checked research texts and local+DB privacy-checked critic diagnostics, safe metadata and private mapping, mode 0600 in 0700 output. No raw answers, identities, full external payloads or unvalidated output in logs/files. No rejected technical candidate retained.",
  credentials:{OpenAI_key_path:keyPath,temporary_OpenAI_file:"private 0700/0600; consumed once and unlinked after source preflight",Supabase:"Reuse already authorized local CLI credential only in process memory against pinned API; do not print, copy or delete existing CLI credential"},
  database:"Explicit READ ONLY transactions followed by ROLLBACK, exact unchanged validator MD5; source/history guards checked around each validation and at completion. No report/synthesis/participant/job/lease rows, migrations, env/deploy/email/production actions.",
  output_directory:out,owner_acceptance:"PENDING; no automatic winner or quality acceptance",approval_user_reply:null};
 if(retry){const prior=previousRun();Object.assign(plan,{previous_run:prior,serialization_preflight_sha256:sizePreflight(),maximum_external_calls:retryCalls,maximum_USD:Number((13.14-prior.reserved_USD).toFixed(8)),maximum_privacy_repair_calls_total:retryRepairs,request_byte_caps:foodtechRequestByteCaps,output_directory:retryOut,aggregate_new_run_liability_bound_USD:cOnly?5.42:bc?8.62:12.48,cumulative_maximum_external_calls:18,cumulative_maximum_USD:13.14,transport_change:"Per-stage UTF8 request caps replace the common 120000-byte cap; all evidence and historical A prompts unchanged. Pure serializer shared by offline preflight and real transport. Numeric budget causes recorded without payloads.",previous_output:"Only the first synthesis completed; its text was not retained. Restart repeats synthesis once within this newly approved request budget; old run and artifacts preserved."});plan.pricing.maximum_request_bytes=Math.max(...Object.values(foodtechRequestByteCaps));}
 if(bc)Object.assign(plan,{variants:["B","C"],normal_calls:{B:3,C:6},normal_calls_total:9,baseline_A:"Already stopped on critical privacy and substantive critic defects. Do not regenerate A or retain its rejected report; preserve checked critic diagnostics. This is not a full three-text blind comparison.",data:"Same frozen FoodTech source for B/C. All group means, stddev_pop, question wording and context preserved. B/C AI dynamics inputs omit min/max and score histograms. Raw corpus remains local only; masked groups go only to extraction.",evaluation:"Two randomly numbered private research candidates from B/C, with the same final critic. Owner may reject both. Critic numeric/privacy defects still stop; other substantive defects are retained for diagnosis only, not acceptance.",previous_output:"Six FoodTech requests consumed across two stopped runs; no accepted or retained report. Existing checked critic diagnostics remain private. No paid baseline A repetition."});
 if(cOnly)Object.assign(plan,{variants:["C"],normal_calls:{C:6},normal_calls_total:6,baseline_A:"Already rejected on critic privacy and substantive defects; no regeneration.",baseline_B:"Stopped after report privacy-repair failed the unchanged fact guard; rejected text not retained, no regeneration.",data:"Same read-only FoodTech source and projected group means/stddev, no extrema or score histograms. Masked groups only to extraction; raw corpus stays local. Protected numeric/maturity sentences are copied unchanged, never sent to repair; only editable generated prose fragments may be repaired.",evaluation:"One C candidate for substantive owner feedback, not a blind architecture comparison or architecture winner. Numeric/privacy critic defects still hard-stop; other substantive defects retained for diagnosis only.",previous_output:"Nine FoodTech calls across three stopped runs; no accepted or retained report. Run C only, no repeated A/B calls.",repair_change:"Copy protected fact statements deterministically; keep unchanged full-field preservesReportFacts check and local+DB privacy gates. A privacy match inside a protected statement stops before a repair API call. Payload-free reason and path recorded.",cumulative_maximum_external_calls:17});
 save(retry?retryPlanPath:planPath,plan);console.log("FoodTech plan prepared; no external AI calls.");
}
async function preflight(){
 const transport=privateManagementQuery();try{const source=foodtechSource(transport.query,baseline()),f=await source.load();
  await source.validate({check:"Приватная проверка без публикации отчёта."});let denied=false;try{await source.validate({check:"nobody@example.test"});}catch(e){denied=e instanceof Error&&e.message==="quality_db_rejected";}if(!denied)throw Error();
  const raw=f.corpus.answers.find(a=>Array.from(a.text).length>=32)?.text;if(!raw)throw Error();const p=inspectTeamOutputPrivacy({text:raw},f.corpus);if(!p.overlaps.length&&!p.policyViolation)throw Error();await source.metadata();
  const primary=inspectTeamOutputPrivacy(buildDossier(f.aggregates,f.qualitative).primary,f.corpus);if(primary.overlaps.length||primary.policyViolation)throw Error("foodtech_context_projection_required");
  console.log(JSON.stringify({status:"FOODTECH_PRIVATE_PREFLIGHT_PASS",participants:3,blocks:8,questions:80,groups:4,DB_positive_and_negative:true,local_actual_overlap:true,externalAICalls:0,mutations:0}));
 }finally{transport.close();}
}
async function run(simulated=false,retry=false){
 const expectedOut=retry?retryOut:out,prior=retry?previousRun():null;
 const output=simulated?join(base,"foodtech-controller-simulation-"+randomUUID()):expectedOut;
 const maxCalls=retry?retryCalls:18,maxUSD=retry?Number((13.14-prior!.reserved_USD).toFixed(8)):13.14;
 const plan=simulated?{run_id:randomUUID(),commit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),model:"authored-stubs",reasoning_effort:null}:JSON.parse(readFileSync(retry?retryPlanPath:planPath,"utf8"));
 if(retry&&!simulated&&plan.serialization_preflight_sha256!==sizePreflight())throw Error("foodtech_size_preflight_required");
 if(!simulated&&(plan.status!=="APPROVED"||!plan.approval_user_reply||plan.date!==new Date().toISOString().slice(0,10)||plan.project!==FOODTECH.project||plan.model!=="gpt-5.6-sol"||plan.reasoning_effort!=="medium"||plan.maximum_external_calls!==maxCalls||plan.maximum_USD!==maxUSD||plan.output_directory!==expectedOut||plan.credentials.OpenAI_key_path!==keyPath||JSON.stringify(plan.source)!==JSON.stringify(baseline())||JSON.stringify(plan.source_files)!==JSON.stringify(sources())||plan.commit!==execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()||execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim()||(retry&&(JSON.stringify(plan.request_byte_caps)!==JSON.stringify(foodtechRequestByteCaps)||JSON.stringify(plan.previous_run)!==JSON.stringify(prior)||plan.maximum_privacy_repair_calls_total!==retryRepairs))||(bc&&JSON.stringify(plan.variants)!=='["B","C"]')||(cOnly&&JSON.stringify(plan.variants)!=='["C"]')))throw Error("foodtech_approval_required");
 if(existsSync(output))throw Error("foodtech_output_exists");
 const fixture=simulated?qualityCase("production"):null,db=simulated?createQualityDatabase():null;
 const transport=simulated?{query:async()=>[],close:()=>db!.close()}:privateManagementQuery();
 const source=simulated?{load:async()=>fixture!,metadata:async()=>({}),validate:db!.load(fixture!)}:foodtechSource(transport.query,plan.source);
 const stubs=fixture?authoredStageStubs(fixture):null;
 if(stubs)stubs.review={verdict:"fail",defects:[{path:"summary",code:"system_scope",critical:true,reason:"Имитация содержательного отказа для проверки журнала и маркировки.",required_change:"Нужна оценка владельца; это не реальный AI-текст."}]};
 const events:(SafeEvent&{cell:string})[]=[],attempts:(Record<string,unknown>)[]=[],receipts:(CallReceipt&{cell:string})[]=[],mapping:{label:string;variant:Variant}[]=[],cells:Record<string,unknown>[]=[];
 let cell="source_preflight",key="",failed=false,failureCode:string|null=null,failureDetails:Record<string,unknown>|null=null,repairsTotal=0;
 try{
  const f=await source.load();await source.validate({check:"Проверка неизменности источника перед запуском."});
  const primary=inspectTeamOutputPrivacy(buildDossier(f.aggregates,f.qualitative).primary,f.corpus);
  if(primary.overlaps.length||primary.policyViolation)throw Error("team_privacy_rejected");
  if(existsSync(output))throw Error("foodtech_output_exists");mkdirSync(output,{mode:0o700});
  if(!simulated)key=consumePrivateKey(keyPath);const deadline=Date.now()+90*60000;
  const approvedCall=simulated?null:createApprovedPort({apiKey:key,approved:true,model:"gpt-5.6-sol",effort:"medium",maxCalls,maxUSD,deadline,requestByteCaps:retry?foodtechRequestByteCaps:undefined,attempt:r=>{attempts.push({...r,cell,at:new Date().toISOString()});console.log(JSON.stringify({event:"external_call_sent",...r,cell}));},receipt:r=>receipts.push({...r,cell})});key="";
  const call:import("../src/server/team/quality/runtime").StagePort=async request=>{if(request.stage==="privacy_repair"&&++repairsTotal>(retry?retryRepairs:6))throw new QualityBudgetError("call_limit",request.stage,0,0);await source.metadata();return approvedCall?approvedCall(request):structuredClone(stubs![request.stage]);};
  const variants:Variant[]=cOnly?["C"]:bc?["B","C"]:["A","B","C"];for(let i=variants.length-1;i>0;i--){const j=randomInt(i+1);[variants[i],variants[j]]=[variants[j],variants[i]];}
  for(let i=0;i<variants.length;i++){
   const variant=variants[i];cell=`foodtech-${i+1}`;await source.metadata();mapping.push({label:cell,variant});
   const result=await runQualityVariant({...f,variant,researchComparison:true,maxCalls:normal[variant]+2,deadline:Math.min(deadline,Date.now()+30*60000),databaseValidate:source.validate,call,emit:e=>events.push({...e,cell})});
   await source.metadata();
   writeFileSync(join(output,cell+".html"),blindReviewHtml(result.report,cell,String(f.aggregates.company_context.company_name),simulated,true),{mode:0o600,flag:"wx"});
   save(join(output,cell+"-private-review.json"),{status:"RESEARCH_DIAGNOSTIC_NOT_OWNER_ACCEPTANCE",...result.review});
   cells.push({label:cell,status:result.review?.verdict==="pass"&&!result.review.defects.length?"AUTOMATIC_REVIEW_PASS_OWNER_PENDING":"AUTOMATIC_QUALITY_FAILED_OWNER_DIAGNOSTIC",calls:result.calls});
  }
  await source.metadata();
 }catch(e){failed=true;const m=e instanceof Error?e.message:"";failureCode=["foodtech_source_changed","foodtech_source_unavailable","quality_db_rejected","quality_stage_failed","quality_budget_exhausted","quality_reference_invalid","quality_dependency_invalid","team_numeric_integrity","team_privacy_rejected","team_quality_rejected","team_qualitative_insufficient","quality_private_key_guard"].includes(m)?m:"foodtech_controller_stopped";
  if(e instanceof QualityBudgetError||e instanceof QualityRepairError)failureDetails=e.safeDetails();
  if(existsSync(output)&&e instanceof QualityCriticRejection)save(join(output,cell+"-rejected-private-review.json"),{status:"REJECTED_DIAGNOSTIC_ONLY",...e.review});
  if(e instanceof QualityReferenceError)cells.push({label:cell,status:"TECHNICAL_REJECTION",reason:e.reason});
 }finally{
  key="";try{transport.close();}catch{failed=true;}
  if(existsSync(output)){save(join(output,"private-mapping.json"),mapping);save(join(output,"run-metadata.json"),{status:failed?"STOPPED":simulated?"SIMULATION_MECHANICS_ONLY":"RESEARCH_COMPARISON_OWNER_REVIEW_REQUIRED",simulated,runId:plan.run_id,commit:plan.commit,model:plan.model,effort:plan.reasoning_effort,failureCode,failureDetails,cells,attempts,receipts,events,externalCalls:attempts.length,ownerAcceptance:"PENDING",stagingMutations:0});}
 }
 console.log(JSON.stringify({status:failed?"STOPPED":simulated?"SIMULATION_MECHANICS_ONLY":"RESEARCH_COMPARISON_OWNER_REVIEW_REQUIRED",cells:cells.length,externalCalls:attempts.length,output:existsSync(output)?output:null}));if(failed)process.exitCode=1;
}
async function main(){if(process.argv[2]==="--prepare-plan")prepare();else if(["--prepare-size-retry-plan","--prepare-bc-plan","--prepare-c-only-plan"].includes(process.argv[2]))prepare(true);else if(process.argv[2]==="--preflight")await preflight();else if(process.argv[2]==="--simulate")await run(true);else if(["--simulate-size-retry","--simulate-bc","--simulate-c-only"].includes(process.argv[2]))await run(true,true);else if(process.argv[2]==="--approved-plan")await run();else if(["--approved-size-retry-plan","--approved-bc-plan","--approved-c-only-plan"].includes(process.argv[2]))await run(false,true);else throw Error();}
void main().catch(()=>{console.error("foodtech_controller_stopped; no payload details");process.exitCode=1;});
