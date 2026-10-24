import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {runControlledTeamOnce} from '@/server/team/controlled-runner';
import {processTeamJob,runTeamJobs} from '@/server/team/worker';
import {controlledTeamModel,type ControlledTeamClaim,type ControlledTeamRpc} from '@/server/team/controlled-ai-transport';
import {mockTeamSynthesisV3,mockTeamReportV3} from '@/server/team/report-v3-provider';
import {mainTeamReportInputV3} from '@/server/team/report-v3-contracts';
import {meanEvidence,qualitativeFixture} from './v3-fixtures';
vi.mock('openai',()=>({default:class {constructor(){throw Error('unguarded SDK path forbidden in controlled tests');}}}));
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=Date.parse('2026-10-23T18:00:00Z'),sha='a'.repeat(40);
const claim:ControlledTeamClaim={run_id:id(1),team_id:id(2),report_id:id(3),source_fingerprint:'a'.repeat(64),job_id:id(4),kind:'team_ai_report',lease_token:id(5),lease_expires_at:new Date(now+600000).toISOString(),deadline_at:new Date(now+540000).toISOString(),server_now:new Date(now).toISOString(),pipeline_version:'TEAM-RU-3',provider_mode:'openai',attempts:1};
const env={APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co',NODE_ENV:'production',RENDER_GIT_COMMIT:sha,TEAM_ENABLED:'true',TEAM_AI_PROVIDER:'openai',TEAM_AI_MODEL:controlledTeamModel,...Object.fromEntries(['ACQUISITION_ENABLED','ACQUISITION_START_ENABLED','BILLING_ENABLED','YOOKASSA_REFUNDS_ENABLED','YOOKASSA_RECONCILIATION_ENABLED'].map(key=>[key,'false']))};
const manifest={runId:claim.run_id,teamId:claim.team_id,reportId:claim.report_id,sourceFingerprint:claim.source_fingerprint,kind:claim.kind,expectedSHA:sha};
function fixture(){
 const evidence=meanEvidence();evidence.participant_count=3;evidence.overall.participant_count=3;evidence.blocks=evidence.blocks.map(b=>({...b,participant_count:3}));evidence.questions=evidence.questions.map(q=>({...q,participant_count:3,distribution:q.distribution.map(n=>n?3:0)}));
 const qualitative=qualitativeFixture();qualitative.block_aggregates=evidence.blocks;
 const synthesis=mockTeamSynthesisV3(qualitative),report=mockTeamReportV3(mainTeamReportInputV3(evidence,synthesis));
 const spent=new Set<string>();let ordinal=20,stage='';
 const rpc=vi.fn<ControlledTeamRpc>(async(name,args)=>{
  if(name==='claim_controlled_team_job')return{data:claim,error:null};
  if(name==='reserve_controlled_team_ai_call'){stage=String(args.p_stage);if(spent.has(stage))return{data:null,error:{message:'spent'}};spent.add(stage);return{data:{...claim,model:controlledTeamModel,reservation_id:id(ordinal++),stage},error:null};}
  if(name==='complete_controlled_team_effect')return{data:{status:args.p_status},error:null};
  if(name==='prepare_team_report_job')return{data:{status:'generating',controlled_run_id:claim.run_id,pipeline_version:'TEAM-RU-3',provider_mode:'openai',qualitative_input:qualitative,report_input:evidence,synthesis:null},error:null};
  if(name==='get_team_synthesis_privacy_corpus')return{data:{threshold:32,answers:qualitative.groups.flatMap(g=>g.texts.map(text=>({question_index:1,text}))),identifiers:['private@example.test']},error:null};
  if(name==='stop_controlled_team_run')return{data:{status:'stopped'},error:null};
  return{data:name==='store_team_synthesis'?'stored':name==='fail_team_job'?null:'completed',error:null};
 });
 const fetch=vi.fn<typeof globalThis.fetch>(async input=>new Response(JSON.stringify(String(input).includes('/models/')?{id:controlledTeamModel}:{id:'resp_safe',model:controlledTeamModel,status:'completed',usage:{input_tokens:1,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(stage==='synthesis'?synthesis:report)}]}]}),{status:200,headers:{'content-type':'application/json'}}));
 return{rpc,fetch,spent,evidence,qualitative,report};
}
const windowId=id(50),planSHA256='f'.repeat(64);
const windowManifest={...manifest,version:2,continuationWindowId:windowId,planSHA256};
const windowEnv={...env,TEAM_CREATION_ENABLED:'false',TEAM_INVITATIONS_ENABLED:'false'};
function windowFixture(){
 const f=fixture(),windowClaim={...claim,window_id:windowId,approved_plan_hash:planSHA256};
 const rpc=vi.fn<ControlledTeamRpc>(async(name,args)=>{
  if(name==='claim_controlled_team_window_job')return{data:windowClaim,error:null};
  if(name==='reserve_controlled_team_window_ai_call'){
   const result=await f.rpc('reserve_controlled_team_ai_call',args);
   return result.error?result:{...result,data:{...(result.data as object),window_id:windowId,approved_plan_hash:planSHA256}};
  }
  if(name==='stop_controlled_team_window')return{data:{status:'stopped'},error:null};
  if(name==='prepare_team_report_job'){
   const result=await f.rpc(name,args);
   return{...result,data:{...(result.data as object),controlled_window_id:windowId}};
  }
  if(['claim_controlled_team_job','reserve_controlled_team_ai_call','stop_controlled_team_run'].includes(name))throw Error('legacy root operation refused');
  return f.rpc(name,args);
 });
 return{...f,rpc,windowClaim};
}
beforeEach(()=>{vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
describe('one-shot controlled Team worker',()=>{
 it('uses canonical three-participant V3 validators, exact claim, GET then two Responses, never ordinary SDK',async()=>{
  const f=fixture();const result=await runControlledTeamOnce(manifest,{...f,env,apiKey:'synthetic-only',monotonic:()=>0});
  expect(result.status).toBe('CONTROLLED_TEAM_COMPLETED');expect(result.audit).toMatchObject({modelHTTPStarted:1,responsesHTTPStarted:2});expect(f.rpc.mock.calls[0]).toEqual(['claim_controlled_team_job',{p_run_id:claim.run_id,p_kind:'team_ai_report',p_source_fingerprint:claim.source_fingerprint,p_report_id:claim.report_id}]);
  expect(f.rpc.mock.calls.map(x=>x[0])).not.toContain('claim_team_jobs_v3');expect(f.rpc.mock.calls.map(x=>x[0])).toContain('publish_team_report');expect(f.fetch).toHaveBeenCalledTimes(3);
  const main=JSON.parse(String(f.fetch.mock.calls[2][1]?.body));for(const text of f.qualitative.groups[0].texts)expect(main.input[1].content).not.toContain(text);expect(JSON.stringify(result)).not.toContain('synthetic-only');
 });
 it('stops a denied model before synthesis/report and terminally fails only its owned lease',async()=>{
  const f=fixture();f.fetch.mockResolvedValueOnce(new Response('{}',{status:401}));const result=await runControlledTeamOnce(manifest,{...f,env,apiKey:'synthetic-only',monotonic:()=>0});
  expect(result.status).toBe('CONTROLLED_TEAM_STOP_CONTAINED');expect(f.fetch).toHaveBeenCalledOnce();expect(f.rpc.mock.calls.map(x=>x[0])).not.toContain('prepare_team_report_job');expect(f.rpc.mock.calls.filter(x=>x[0]==='fail_team_job')).toHaveLength(1);expect(f.rpc.mock.calls.at(-1)?.[0]).toBe('stop_controlled_team_run');
 });
 it('foreign claim is never processed or failed under a guessed lease',async()=>{
  const f=fixture(),rpc:ControlledTeamRpc=async(name,args)=>name==='claim_controlled_team_job'?{data:{...claim,team_id:id(999)},error:null}:f.rpc(name,args);
  const result=await runControlledTeamOnce(manifest,{...f,rpc,env,apiKey:'synthetic-only',monotonic:()=>0});expect(result.status).toBe('CONTROLLED_TEAM_STOP_HOLD');expect(f.fetch).not.toHaveBeenCalled();expect(f.rpc.mock.calls.map(x=>x[0])).not.toContain('fail_team_job');
 });
 it('unknown fail RPC outcome is surfaced and never retried or treated as contained',async()=>{
  const f=fixture();f.fetch.mockResolvedValueOnce(new Response('{}',{status:401}));const rpc=vi.fn<ControlledTeamRpc>(async(name,args)=>name==='fail_team_job'?{data:null,error:{message:'lease lost'}}:f.rpc(name,args));
  const result=await runControlledTeamOnce(manifest,{...f,rpc,env,apiKey:'synthetic-only',monotonic:()=>0});expect(result.status).toBe('CONTROLLED_TEAM_STOP_HOLD');expect(rpc.mock.calls.filter(x=>x[0]==='fail_team_job')).toHaveLength(1);expect(f.fetch).toHaveBeenCalledOnce();
 });
 it('aggregate execution performs zero OpenAI requests',async()=>{
  const f=fixture(),aggregate={...claim,kind:'team_aggregate' as const,report_id:null,pipeline_version:'AGG-V1',provider_mode:null,deadline_at:null};const rpc:ControlledTeamRpc=async(name,args)=>name==='claim_controlled_team_job'?{data:aggregate,error:null}:f.rpc(name,args);
  const result=await runControlledTeamOnce({...manifest,kind:'team_aggregate',reportId:null},{...f,rpc,env,monotonic:()=>0});expect(result.status).toBe('CONTROLLED_TEAM_COMPLETED');expect(f.fetch).not.toHaveBeenCalled();expect(f.rpc.mock.calls.map(x=>x[0])).toContain('process_team_aggregate');
 });
 it('ordinary production Team loop and direct unscoped processing fail closed',async()=>{
  for(const [key,value]of Object.entries(env))vi.stubEnv(key,value);
  expect(await runTeamJobs()).toBe(0);const f=fixture();await expect(processTeamJob({id:claim.job_id,kind:claim.kind,lease_token:claim.lease_token,attempts:1,controlled_run_id:claim.run_id},f.rpc)).rejects.toThrow('controlled_team_claim_required');expect(f.rpc).not.toHaveBeenCalled();
 });
 it('runtime drift fails before claim/provider traffic',async()=>{
  const f=fixture();for(const delta of [{BILLING_ENABLED:'true'},{RENDER_GIT_COMMIT:'b'.repeat(40)},{TEAM_AI_MODEL:'other'},{APP_URL:'https://wrong.example'}])await expect(runControlledTeamOnce(manifest,{...f,env:{...env,...delta},apiKey:'synthetic-only'})).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
 });
 it('slow model receipt crosses the deadline without starting any work RPC', async () => {
  const f = fixture();
  let clock = 0;
  const rpc: ControlledTeamRpc = async (name, args) => {
   const result = await f.rpc(name, args);
   if (name === 'complete_controlled_team_effect') clock = 539000;
   return result;
  };
  const result = await runControlledTeamOnce(manifest, {...f, rpc, env, apiKey: 'synthetic-only', monotonic: () => clock});
  expect(result.status).toBe('CONTROLLED_TEAM_STOP_CONTAINED');
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.rpc.mock.calls.map(call => call[0])).not.toContain('prepare_team_report_job');
  expect(f.rpc.mock.calls.filter(call => call[0] === 'fail_team_job')).toHaveLength(1);
 });
 it('refuses publication when less than one work RPC timeout remains before the deadline', async () => {
  const f = fixture();
  let clock = 0, stage = '';
  const rpc: ControlledTeamRpc = async (name, args) => {
   if (name === 'reserve_controlled_team_ai_call') stage = String(args.p_stage);
   const result = await f.rpc(name, args);
   if (name === 'complete_controlled_team_effect' && stage === 'main_report') clock = 510000;
   return result;
  };
  const result = await runControlledTeamOnce(manifest, {...f, rpc, env, apiKey: 'synthetic-only', monotonic: () => clock});
  expect(result.status).toBe('CONTROLLED_TEAM_STOP_CONTAINED');
  expect(f.fetch).toHaveBeenCalledTimes(3);
  expect(f.rpc.mock.calls.map(call => call[0])).not.toContain('publish_team_report');
  expect(f.rpc.mock.calls.filter(call => call[0] === 'fail_team_job')).toHaveLength(1);
 });
});

describe('W2 exact manifest and shared-budget worker',()=>{
 it('binds root/window/approved plan on claim and every AI reservation, with the unchanged pipeline',async()=>{
  const f=windowFixture();
  const result=await runControlledTeamOnce(windowManifest,{...f,env:windowEnv,apiKey:'synthetic-only',monotonic:()=>0});
  expect(result).toMatchObject({status:'CONTROLLED_TEAM_COMPLETED',runId:claim.run_id,continuationWindowId:windowId,audit:{modelHTTPStarted:1,responsesHTTPStarted:2}});
  expect(f.rpc.mock.calls[0]).toEqual(['claim_controlled_team_window_job',{p_run_id:claim.run_id,p_window_id:windowId,p_kind:claim.kind,p_source_fingerprint:claim.source_fingerprint,p_report_id:claim.report_id}]);
  for(const [name,args]of f.rpc.mock.calls.filter(([name])=>name==='reserve_controlled_team_window_ai_call')){
   expect(name).toBe('reserve_controlled_team_window_ai_call');expect(args).toMatchObject({p_run_id:claim.run_id,p_window_id:windowId,p_job_id:claim.job_id,p_lease_token:claim.lease_token});
  }
  expect(f.fetch).toHaveBeenCalledTimes(3);
 });
 it.each([{window_id:id(99)},{approved_plan_hash:'b'.repeat(64)},{window_id:null}])('does not process or fail a mismatched window/plan claim %j',async delta=>{
  const f=windowFixture(),rpc=vi.fn<ControlledTeamRpc>(async(name,args)=>name==='claim_controlled_team_window_job'?{data:{...f.windowClaim,...delta},error:null}:f.rpc(name,args));
  const result=await runControlledTeamOnce(windowManifest,{...f,rpc,env:windowEnv,apiKey:'synthetic-only',monotonic:()=>0});
  expect(result.status).toBe('CONTROLLED_TEAM_STOP_HOLD');expect(f.fetch).not.toHaveBeenCalled();
  expect(rpc.mock.calls.map(([name])=>name)).not.toContain('fail_team_job');
  expect(rpc.mock.calls.at(-1)).toEqual(['stop_controlled_team_window',{p_run_id:claim.run_id,p_window_id:windowId,p_reason:'controlled_worker_stopped'}]);
 });
 it('burnt root stage reservation denies a restarted W2 without a second HTTP and never stops/reopens root',async()=>{
  const f=windowFixture();f.spent.add('model_get');
  const result=await runControlledTeamOnce(windowManifest,{...f,env:windowEnv,apiKey:'synthetic-only',monotonic:()=>0});
  expect(result.status).toBe('CONTROLLED_TEAM_STOP_CONTAINED');expect(f.fetch).not.toHaveBeenCalled();
  expect(f.rpc.mock.calls.map(([name])=>name)).not.toContain('stop_controlled_team_run');
  expect(f.rpc.mock.calls.filter(([name])=>name==='stop_controlled_team_window')).toHaveLength(1);
 });
 it('rejects a stale v1 manifest trying to claim a W2-bound job',async()=>{
  const f=fixture(),rpc:ControlledTeamRpc=async(name,args)=>name==='claim_controlled_team_job'?{data:{...claim,window_id:windowId,approved_plan_hash:planSHA256},error:null}:f.rpc(name,args);
  const result=await runControlledTeamOnce(manifest,{...f,rpc,env,apiKey:'synthetic-only',monotonic:()=>0});
  expect(result.status).toBe('CONTROLLED_TEAM_STOP_HOLD');expect(f.fetch).not.toHaveBeenCalled();expect(f.rpc.mock.calls.map(([name])=>name)).not.toContain('fail_team_job');
 });
 it('window or approved-plan mismatch in an AI reservation prevents the HTTP dispatch',async()=>{
  for(const delta of [{window_id:id(99)},{approved_plan_hash:'b'.repeat(64)},{window_id:undefined}]){
   const f=windowFixture(),rpc:ControlledTeamRpc=async(name,args)=>{
    const result=await f.rpc(name,args);
    return name==='reserve_controlled_team_window_ai_call'?{...result,data:{...(result.data as object),...delta}}:result;
   };
   const result=await runControlledTeamOnce(windowManifest,{...f,rpc,env:windowEnv,apiKey:'synthetic-only',monotonic:()=>0});
   expect(result.status).toBe('CONTROLLED_TEAM_STOP_CONTAINED');expect(f.fetch).not.toHaveBeenCalled();
  }
 });
 it('requires generic Team gates OFF and a strict versioned manifest before any RPC',async()=>{
  const f=windowFixture();
  for(const value of [{...manifest,continuationWindowId:windowId},{...windowManifest,version:1},{...windowManifest,planSHA256:undefined},{...windowManifest,extra:'ignored?'}]){
   await expect(runControlledTeamOnce(value,{...f,env:windowEnv,apiKey:'synthetic-only'})).rejects.toThrow();
  }
  for(const key of ['TEAM_CREATION_ENABLED','TEAM_INVITATIONS_ENABLED'])await expect(runControlledTeamOnce(windowManifest,{...f,env:{...windowEnv,[key]:'true'},apiKey:'synthetic-only'})).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
 });
 it('a foreign prepared window is refused before synthesis or report Responses',async()=>{
  const f=windowFixture(),rpc:ControlledTeamRpc=async(name,args)=>{
   const result=await f.rpc(name,args);
   return name==='prepare_team_report_job'?{...result,data:{...(result.data as object),controlled_window_id:id(99)}}:result;
  };
  const result=await runControlledTeamOnce(windowManifest,{...f,rpc,env:windowEnv,apiKey:'synthetic-only',monotonic:()=>0});
  expect(result.status).toBe('CONTROLLED_TEAM_STOP_CONTAINED');expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.rpc.mock.calls.map(([name])=>name)).not.toContain('publish_team_report');
 });
});
