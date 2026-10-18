/** Offline transport simulation only. No network or database credentials; all fetches are replaced. */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { v2Evidence } from "../tests/team/v2-fixtures.ts";
import { mockTeamReportV2 } from "../src/server/team/report-v2-provider.ts";
const root=resolve(process.cwd()),artifacts=resolve(root,"../artifacts/v22c-rich-team-ai");
const raw="Ответственность за процесс не закреплена между подразделениями";
const safe="Управленческая команда описывает нерегулярную координацию и отсутствие устойчивого цикла совместного принятия решений.";
const replacement="Границы ведения процесса между функциональными направлениями не распределены.";
const privateMarker="PRIVATE_CORPUS_ONLY_NEVER_EXTERNAL";
const summary=()=>({themes:[{title:"Совместное исполнение",summary:safe,question_position:1,response_count:3}],strengths:[safe],problem_patterns:[safe],growth_constraints:[safe],risks:[safe],opportunities:[safe],alignment_signals:[safe],divergence_signals:[safe],contradictions:[safe],management_implications:[safe],discussion_topics:[safe]});
const evidence=v2Evidence();evidence.participant_count=5;evidence.overall.participant_count=5;evidence.blocks.forEach(b=>b.participant_count=5);
for(const q of evidence.questions){q.distribution[2]++;q.participant_count=5;q.mean=q.distribution.reduce((a,n,i)=>a+n*i,0)/5;q.stddev_pop=Math.sqrt(q.distribution.reduce((a,n,i)=>a+n*(i-q.mean)**2,0)/5);q.min=q.distribution.findIndex(n=>n>0);q.max=q.distribution.findLastIndex(n=>n>0);}
const qualitative={company_context:evidence.company_context,block_aggregates:evidence.blocks,groups:[1,2,83,84].map(question_position=>({question:"Синтетический вопрос",question_position,block_title:"Общие вопросы",response_count:5,texts:[raw,raw,raw,raw,raw],relevant_block:null}))};
const prepared={pipeline_version:"TEAM-RU-2",synthesis:null,qualitative_input:qualitative,report_input:evidence};
const corpus={threshold:32,answers:[...qualitative.groups.flatMap(g=>g.texts.map(text=>({question_index:g.question_position,text}))),{question_index:84,text:privateMarker}],identifiers:["fixture-secret@example.test"]};
const results=[];
for(const scenario of ["clean","repair","still_leaks","wrong_paths","gate_before_synthesis","extra_report"]){
 const directory=mkdtempSync("/private/tmp/aca-v22c-real-simulator-");let child:ReturnType<typeof spawn>|null=null;
 try{
  const initial=summary();if(!["clean","gate_before_synthesis"].includes(scenario))initial.risks=[raw];
  const responses=[initial,...(["clean","gate_before_synthesis"].includes(scenario)?[]:[{repairs:[{path:scenario==="wrong_paths"?"strengths[0]":"risks[0]",replacement:scenario==="still_leaks"?raw:replacement}]}]),mockTeamReportV2(evidence,summary())];
  const preload=join(directory,"offline-fetch.mjs");
  writeFileSync(preload,`const responses=${JSON.stringify(responses)};let cursor=0;globalThis.fetch=async(url,options)=>{if(url!=="https://api.openai.com/v1/responses"||options.body.includes(${JSON.stringify(privateMarker)}))throw Error("offline_scope_guard");const value=responses[cursor++];if(!value)throw Error("offline_budget_exceeded");return new Response(JSON.stringify({id:"simulated-"+cursor,object:"response",created_at:0,status:"completed",model:"gpt-5.6-sol",output:[{type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify(value),annotations:[]}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}),{status:200,headers:{"content-type":"application/json"}});};`,{mode:0o600});
  writeFileSync(join(directory,"OPENAI_API_KEY.txt"),"sk-synthetic-key-only-never-valid-000000000000000000000000",{mode:0o600});
  child=spawn(process.execPath,["--import","tsx","--import",preload,join(artifacts,"bounded-repair-real-driver.mts"),directory],{cwd:root,env:{PATH:process.env.PATH},stdio:["ignore","pipe","pipe"]});
  let exited=false,stdout="",stderr="";const exit=new Promise<number|null>(resolve=>child!.once("exit",code=>{exited=true;resolve(code);}));
  child.stdout!.on("data",chunk=>stdout+=chunk);child.stderr!.on("data",chunk=>stderr+=chunk);
  const wait=async(test:()=>boolean)=>{const end=Date.now()+12000;while(!test()){if(exited||Date.now()>end)throw Error("offline_driver_wait_failed");await new Promise(resolve=>setTimeout(resolve,25));}};
  let sequence=0;const command=(value:unknown)=>{const path=join(directory,"command-"+String(++sequence).padStart(4,"0"));writeFileSync(path+".pending",JSON.stringify(value),{mode:0o600});renameSync(path+".pending",path+".json");};
  await wait(()=>existsSync(join(directory,"driver-ready.json")));assert(!existsSync(join(directory,"OPENAI_API_KEY.txt")));
  const identity={teamId:"450f7c30-bde0-47fb-9749-d38672e29914",jobId:"85b3a17b-9792-4849-a4dd-90b20c95c215",source:"af0a3cfa3269796dfecd7a71c565d8bc083c5020f97d4274e67dd3a6062f694b",participantCount:5,leaseExpiresAt:new Date(Date.now()+600000).toISOString()};
  if(scenario==="gate_before_synthesis")command({action:"report"});
  else {
   command({action:"synthesize",identity,prepared,privacyCorpus:corpus});
   await wait(()=>existsSync(join(directory,"synthesis-schema-pass.json"))||existsSync(join(directory,"driver-failure.json")));
   if(["clean","repair","extra_report"].includes(scenario)){
    const validatedSynthesis=JSON.parse(readFileSync(join(directory,"synthesis-output.private.json"),"utf8"));
    const request={action:"report",gate:{status:"DB_STORED_PRIVACY_SCHEMA_PASS",jobId:identity.jobId,source:identity.source,sourceCurrent:true},validatedSynthesis};
    command(request);await wait(()=>existsSync(join(directory,"report-schema-pass.json")));
    command(scenario==="extra_report"?request:{action:"stop"});
   }
  }
  const code=await Promise.race([exit,new Promise<null>(resolve=>setTimeout(()=>resolve(null),12000))]);assert.equal(code,0);assert.equal(stderr,"");
  const closed=stdout.trim().split("\n").map(x=>JSON.parse(x)).find(x=>x.event==="driver_closed");
  const expected=scenario==="clean"?2:scenario==="gate_before_synthesis"?0:["still_leaks","wrong_paths"].includes(scenario)?2:3;
  assert.equal(closed.realCallsSent,expected);assert(closed.sentByKind.synthesis<=1&&closed.sentByKind.repair<=1&&closed.sentByKind.report<=1);
  if(["still_leaks","wrong_paths","gate_before_synthesis"].includes(scenario))assert(!existsSync(join(directory,"report-schema-pass.json")));
  assert(!stdout.includes(raw)&&!stdout.includes(privateMarker));
  results.push({scenario,status:"PASS",simulatedCalls:expected,externalCalls:0,counts:closed.sentByKind});
 }finally{
  if(child?.exitCode===null)child.kill("SIGKILL");
  assert(directory.startsWith("/private/tmp/aca-v22c-real-simulator-"));rmSync(directory,{recursive:true,force:true});
 }
}
writeFileSync(join(artifacts,"bounded-repair-driver-simulator-tests.json"),JSON.stringify({status:"PASS",results,externalCalls:0,dbCalls:0,privateTestDirectoriesRemoved:true,transport:"All HTTP replaced by offline synthetic fetch before provider imports; no actual API traffic."},null,2)+"\n");
process.stdout.write(JSON.stringify({status:"PASS",scenarios:results.length,externalCalls:0})+"\n");
