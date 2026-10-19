import { readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,lstatSync,openSync,closeSync,unlinkSync } from "node:fs";
import { resolve,join,sep } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { foodtechSource,privateManagementQuery,FOODTECH } from "./foodtech-quality-source";
import { createQualityDatabase } from "./quality-local-db";
import { qualityCase } from "./fixtures/team-quality-cases";
import { authoredStageStubs } from "./fixtures/team-quality-stage-stubs";
import { runQualityVariant,stageTokens,type StageRequest,type SafeEvent } from "../src/server/team/quality/runtime";
import { createApprovedPort,type CallReceipt } from "../src/server/team/quality/openai-port";
import { createStageCache,verifyManifest,checkpointOrder,digest,type CheckpointManifest } from "../src/server/team/quality/stage-cache";
import { experimentAccounting } from "../src/server/team/quality/experiment-accounting";
import { researchLedger,appendResearchJournal } from "../src/server/team/quality/research-ledger";
import { foodtechRequestByteCaps,QualityBudgetError } from "../src/server/team/quality/request-budget";
import { consumePrivateKey } from "../src/server/team/quality/private-key";
import { inspectTeamOutputPrivacy } from "../src/server/team/synthesis-privacy";
import { QualityCriticRejection,QualityNumericError,QualityReferenceError } from "../src/server/team/quality/contracts";
import { QualityTextError } from "../src/server/team/quality/text-signals";
import { QualityRepairError } from "../src/server/team/quality/guarded-repair";
import { blindReviewHtml } from "../src/server/team/quality/blind-review";

const base=resolve("../artifacts/v22c4-team-report-quality"),root=join(base,"foodtech-checkpoint-runs"),keyPath="/private/tmp/aca-v22c4-quality/OPENAI_API_KEY.txt";
const mode=process.argv[2],simulated=mode==="--simulate",planPath=resolve(process.argv[3]??join(base,"foodtech-checkpoint-plan.json"));
if(!planPath.startsWith(base+sep)||!planPath.endsWith(".json"))throw Error("quality_plan_path_invalid");
const save=(p:string,v:unknown)=>writeFileSync(p,JSON.stringify(v,null,2)+"\n",{mode:0o600,flag:"wx"});
const baseline=()=>JSON.parse(readFileSync(join(base,"foodtech-readonly-baseline.json"),"utf8"));
const currentCommit=()=>execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
function files(){return Object.fromEntries([...readdirSync("src/server/team/quality").filter(f=>f.endsWith(".ts")).map(f=>"src/server/team/quality/"+f),"scripts/run-foodtech-checkpoint-research.ts","scripts/foodtech-quality-source.ts","scripts/foodtech-request-size-preflight.ts","scripts/fixtures/team-quality-stage-stubs.ts","scripts/fixtures/team-quality-cases.ts","scripts/quality-local-db.ts","scripts/sql/foodtech-quality-readiness.sql","src/server/team/synthesis-privacy.ts","src/server/team/report-privacy.ts","src/server/team/report-v2-contracts.ts","src/server/team/report-v3-contracts.ts","src/server/team/report-v3-provider.ts","src/server/team/synthesis-repair.ts","TEAM_REPORT_PROMPT_RU_3.md","TEAM_SYNTHESIS_PROMPT_RU_3.md","package-lock.json"].sort().map(p=>[p,digest(readFileSync(p))]));}
const historical=["foodtech-real-comparison","foodtech-real-comparison-size-retry","foodtech-real-comparison-bc-privacy","foodtech-real-comparison-c-only-repair","foodtech-real-comparison-c-canonical","foodtech-real-comparison-c-numeric","foodtech-real-comparison-c-editorial"];
function history(){
 const buffers=[...historical.map(p=>readFileSync(join(base,p,"run-metadata.json"))),...researchLedger(root,baseline().fingerprint).map(entry=>entry.bytes)];
 const runs=buffers.map(b=>JSON.parse(b.toString()));
 if(runs.slice(0,7).some((r,i)=>r.status!=="STOPPED"||r.externalCalls!==[1,5,3,3,2,3,7][i]))throw Error("quality_history_invalid");
 return {...experimentAccounting(runs),metadataSHA256:digest(Buffer.concat(buffers))};
}
function sizeProof(path:string){if(!path.startsWith(base+sep)||!path.endsWith(".json"))throw Error("quality_size_preflight_required");const bytes=readFileSync(path),v=JSON.parse(bytes.toString());if(v.status!=="ACTUAL_SOURCE_SERIALIZATION_PASS_AUTHORED_OUTPUTS_ONLY"||v.source_fingerprint!==baseline().fingerprint||v.external_AI_calls!==0)throw Error("quality_size_preflight_required");for(const [p,h] of Object.entries(v.code_sha256))if(digest(readFileSync(p))!==h)throw Error("quality_size_preflight_required");return digest(bytes);}
function budget(resume:CheckpointManifest,ancestors:string[]){
 if(new Set(ancestors).size!==ancestors.length||ancestors.some(p=>!p.startsWith(root+sep)))throw Error("quality_history_invalid");
 const prefix=verifyManifest(resume,root),remaining=[...checkpointOrder,"review" as const].slice(prefix.length),prior=history();
 const liability=remaining.reduce((n,s)=>n+foodtechRequestByteCaps[s]*5/1e6+stageTokens[s]*20/1e6,0)+remaining.length*(foodtechRequestByteCaps.privacy_repair*5/1e6+stageTokens.privacy_repair*20/1e6);
 if(prior.upperUSD+liability>13.14+1e-8)throw Error("quality_total_financial_cap");
 return {prior,remaining,normalCalls:remaining.length,maxCalls:remaining.length*2,maxRepairs:remaining.length,maximumUSD:Number(liability.toFixed(8)),cumulativeMaximumCalls:prior.calls+remaining.length*2};
}
function prepare(){
 if(existsSync(join(root,"active.lock")))throw Error("quality_incomplete_run_requires_audit");
 const resumeArg=process.argv.find(a=>a.startsWith("--resume-from=")),resumeFrom=resumeArg?resolve(resumeArg.slice(14)):null;
 let resume:CheckpointManifest={},ancestors:string[]=[];
 if(resumeFrom){if(!resumeFrom.startsWith(root+sep))throw Error("quality_resume_invalid");const old=JSON.parse(readFileSync(join(resumeFrom,"run-metadata.json"),"utf8"));if(old.status!=="STOPPED"||old.simulated!==false||old.quarantined||!old.checkpoints)throw Error("quality_resume_invalid");resume=old.checkpoints;ancestors=[...old.ancestors,resumeFrom];}
 const runId=randomUUID(),b=budget(resume,ancestors),source_files=files(),proofArg=process.argv.find(a=>a.startsWith("--size-proof=")),serializationPath=proofArg?resolve(proofArg.slice(13)):join(base,"foodtech-checkpoint-size-proof.json");
 save(planPath,{status:"PREPARED_REQUIRES_EXPLICIT_APPROVAL",approval_user_reply:null,date:new Date().toISOString().slice(0,10),runId,commit:currentCommit(),source_files,source:baseline(),project:FOODTECH.project,model:"gpt-5.6-sol",effort:"medium",variant:"C",output:join(root,runId),resume,ancestors,budget:b,serializationPath,serializationSHA256:sizeProof(serializationPath),
  accounting:"Explicitly reconcile verified nonzero completed receipts at $5/M input and $20/M output, no cache discount; unresolved calls retain full reservation. Not an invoice. Overall ceiling $13.14 unchanged.",
  checkpoints:"Only generated values after their unchanged runtime stage contract and local/DB privacy checks; private 0700/0600. No raw source, full payload or rejected output. Replay pinned file hashes, code/source/request hashes, schema and all runtime guards; prefix only, no hidden paid replay. After a later-stage failure, earlier independently checked stages may be shown to the owner as PARTIAL research material, never a complete or accepted report. Critic privacy quarantine removes this run's copied/new payloads. Earlier stopped runs had no stage payloads and cannot be resumed. Semantic quality not certified.",
  repairs:"At most one targeted repair per remaining stage, including critic diagnostics, at most six total. No full regeneration or SDK retry. Protected fact copying and unchanged local/DB validators. Default ordinary mode remains two repairs and no checkpoints.",
  stops:"Any technical/reference/numeric/privacy/source/transport/budget/deadline failure stops without automatic retry. Critic numeric/privacy defects hard-stop; privacy critic quarantines this run's copied/new stage payloads and disallows resume. Other quality defects yield only a private unaccepted candidate. Research lexical signals go to the same final critic; owner acceptance mandatory.",
  deadlines:{totalMinutes:90,variantMinutes:30,requestSeconds:180,DBSeconds:15},requestByteCaps:foodtechRequestByteCaps,stageOutputCaps:stageTokens,keyPath,
  boundaries:"Existing FoodTech read only with unchanged source/history/response/validator guards. No DB report/job/participant/lease writes, migrations, deploy/env, email/SMTP/password or production actions. Key consumed once on first uncached external request and file removed; existing CLI credential preserved. No architecture winner or quality acceptance."});
 console.log("Checkpoint research plan prepared; 0 AI calls.");
}
async function run(){
 const plan=simulated?null:JSON.parse(readFileSync(planPath,"utf8")),sourceFiles=files(),codeSHA=digest(JSON.stringify(sourceFiles));
 if(!simulated&&(plan.status!=="APPROVED"||!plan.approval_user_reply||plan.date!==new Date().toISOString().slice(0,10)||plan.commit!==currentCommit()||execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim()||JSON.stringify(plan.source_files)!==JSON.stringify(sourceFiles)||JSON.stringify(plan.source)!==JSON.stringify(baseline())||plan.project!==FOODTECH.project||plan.model!=="gpt-5.6-sol"||plan.effort!=="medium"||plan.variant!=="C"||typeof plan.runId!=="string"||!/^[0-9a-f-]{36}$/.test(plan.runId)||plan.output!==join(root,plan.runId)||plan.keyPath!==keyPath||plan.serializationSHA256!==sizeProof(plan.serializationPath)||JSON.stringify(plan.budget)!==JSON.stringify(budget(plan.resume,plan.ancestors))||JSON.stringify(plan.requestByteCaps)!==JSON.stringify(foodtechRequestByteCaps)||JSON.stringify(plan.stageOutputCaps)!==JSON.stringify(stageTokens)))throw Error("quality_approval_required");
 const fixture=simulated?qualityCase("production"):null,db=simulated?createQualityDatabase():null,transport=simulated?null:privateManagementQuery();
 const source=simulated?{load:async()=>fixture!,metadata:async()=>({}),validate:db!.load(fixture!)}:foodtechSource(transport!.query,plan.source);
 const output=simulated?join(root,randomUUID()):plan.output;
 const attempts:Record<string,unknown>[]=[],receipts:CallReceipt[]=[],events:SafeEvent[]=[],replays:string[]=[];let cache:ReturnType<typeof createStageCache>|undefined,failed=false,failureCode:string|null=null,failureDetails:unknown=null,quarantined=false,key="";
 const requests=new Map<string,StageRequest>();let lock:number|undefined,createdOutput=false;
 try{
  const f=await source.load();await source.validate({check:"Проверка неизменности источника перед исследованием."});
  if(existsSync(output))throw Error("quality_output_exists");mkdirSync(root,{mode:0o700,recursive:true});const rootStat=lstatSync(root);if(rootStat.isSymbolicLink()||!rootStat.isDirectory()||(rootStat.mode&0o077)!==0||rootStat.uid!==process.getuid?.())throw Error("quality_checkpoint_rejected");
  if(!simulated){lock=openSync(join(root,"active.lock"),"wx",0o600);if(JSON.stringify(plan.budget)!==JSON.stringify(budget(plan.resume,plan.ancestors)))throw Error("quality_history_changed");}
  mkdirSync(output,{mode:0o700});createdOutput=true;save(join(output,"run-scope.json"),{simulated,runId:plan?.runId??null});appendResearchJournal(join(output,"run-journal.jsonl"),{kind:"scope",runId:plan?.runId??"simulation",simulated});
  cache=createStageCache(join(output,"checkpoints"),root,{sourceFingerprint:simulated?digest(JSON.stringify(f.aggregates)):plan.source.fingerprint,codeSHA256:codeSHA,model:"gpt-5.6-sol",effort:"medium"},plan?.resume??{});
  const deadline=Date.now()+90*60000,stubs=fixture?authoredStageStubs(fixture):null;let port:ReturnType<typeof createApprovedPort>|null=null;
  if(stubs&&process.argv.includes("--simulate-critic-privacy"))stubs.review={verdict:"fail",defects:[{path:"summary",code:"privacy",critical:true,reason:"Имитация критического сигнала для проверки удаления контрольных файлов.",required_change:"Проверить конфиденциальность."}]};
  const result=await runQualityVariant({...f,variant:"C",researchComparison:true,maxPrivacyRepairs:simulated?6:plan.budget.maxRepairs,maxCalls:12,deadline:Math.min(deadline,Date.now()+30*60000),databaseValidate:source.validate,emit:e=>events.push(e),
   checkedStage:async(stage,value)=>{await source.metadata();const request=requests.get(stage);if(!request)throw Error("quality_checkpoint_rejected");cache!.save(request,value);},
   call:async request=>{
    await source.metadata();requests.set(request.stage,request);const reused=cache!.read(request);
    if(reused!==undefined){const p=inspectTeamOutputPrivacy(reused,f.corpus);if(p.policyViolation||p.overlaps.length)throw Error("quality_checkpoint_rejected");replays.push(request.stage);return reused;}
    if(stubs)return structuredClone(stubs[request.stage]);
    if(!port){key=consumePrivateKey(keyPath);port=createApprovedPort({apiKey:key,approved:true,model:"gpt-5.6-sol",effort:"medium",maxCalls:plan.budget.maxCalls,maxUSD:plan.budget.maximumUSD,deadline,requestByteCaps:foodtechRequestByteCaps,attempt:r=>{appendResearchJournal(join(output,"run-journal.jsonl"),{kind:"attempt",...r});attempts.push(r);console.log(JSON.stringify({event:"external_call_sent",...r}));},receipt:r=>{appendResearchJournal(join(output,"run-journal.jsonl"),{kind:"receipt",...r});receipts.push(r);}});key="";}
    return port(request);
   }});
  await source.metadata();
  writeFileSync(join(output,"foodtech-C.html"),blindReviewHtml(result.report,"FoodTech C",String(f.aggregates.company_context.company_name),simulated,true),{mode:0o600,flag:"wx"});
  save(join(output,"private-review.json"),result.review);save(join(output,"private-editorial-signals.json"),result.editorialSignals);
 }catch(e){failed=true;const code=e instanceof Error?e.message:"";failureCode=["team_privacy_rejected","team_numeric_integrity","team_quality_rejected","quality_reference_invalid","quality_dependency_invalid","quality_stage_failed","quality_budget_exhausted","quality_db_rejected","foodtech_source_changed","foodtech_source_unavailable","quality_checkpoint_rejected","quality_private_key_guard"].includes(code)?code:"checkpoint_controller_stopped";
  if(e instanceof QualityBudgetError||e instanceof QualityNumericError||e instanceof QualityTextError||e instanceof QualityRepairError)failureDetails=e.safeDetails();
  if(e instanceof QualityReferenceError)failureDetails={reason:e.reason};
  if(e instanceof QualityCriticRejection){if(createdOutput)save(join(output,"rejected-private-review.json"),e.review);if(e.review.defects.some(d=>d.code==="privacy")){quarantined=true;cache?.quarantine();}}
 }finally{
  key="";try{transport?.close();db?.close();}catch{failed=true;failureCode??="checkpoint_cleanup_failed";}
  try{if(createdOutput)save(join(output,"run-metadata.json"),{status:failed?"STOPPED":simulated?"SIMULATION_MECHANICS_ONLY":"OWNER_REVIEW_REQUIRED",simulated,commit:currentCommit(),model:simulated?"authored-stubs":"gpt-5.6-sol",effort:"medium",sourceFingerprint:plan?.source.fingerprint??null,failureCode,failureDetails,attempts,receipts,events,externalCalls:attempts.length,replays,checkpoints:cache?.manifest()??{},quarantined,ancestors:plan?.ancestors??[],ownerAcceptance:"PENDING",stagingMutations:0});}finally{if(lock!==undefined){closeSync(lock);unlinkSync(join(root,"active.lock"));}}
 }
 console.log(JSON.stringify({status:failed?"STOPPED":simulated?"SIMULATION_MECHANICS_ONLY":"OWNER_REVIEW_REQUIRED",externalCalls:attempts.length,output:createdOutput?output:null}));if(failed)process.exitCode=1;
}
void (async()=>{if(mode==="--prepare")prepare();else if(mode==="--run"||simulated)await run();else throw Error("quality_mode_invalid");})().catch(()=>{console.error("CHECKPOINT_RESEARCH_STOPPED_NO_PAYLOAD");process.exitCode=1;});
