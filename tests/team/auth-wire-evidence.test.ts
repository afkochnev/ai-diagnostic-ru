import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {authChallengeMAC,authCredentialMAC,readAuthWireJSON,type AuthWireEvidence,type AuthWireScope} from '@/server/team/auth-wire-contract';
import {createAuthWireEvidence} from '@/server-runtime/team-auth-evidence';
import {controlledTeamAuthFetch,controlledTeamW2VerifyFetch} from '@/server/team/controlled-auth-transport';
import type {ControlledTeamContext,ControlledTeamW2Access,ControlledTeamW2Verification} from '@/server-runtime/team-smoke';
import type {ControlledTeamW2Proof} from '@/server-runtime/team-w2-proof';

const R='10000000-0000-4000-8000-000000000001',W='20000000-0000-4000-8000-000000000002',P='30000000-0000-4000-8000-000000000003',U='40000000-0000-4000-8000-000000000004',V='50000000-0000-4000-8000-000000000005',T='60000000-0000-4000-8000-000000000006',plan='a'.repeat(64),invitation='c'.repeat(64),token='b'.repeat(64),email='synthetic@example.test',authorization='Bearer synthetic-service-role-key-never-exported';
const binding=(operation:'issue'|'verify'='verify'):AuthWireScope=>({runId:R,windowId:W,participantId:P,userId:U,operation,reservationId:V,planHash:plan});
const scope=(operation:'issue'|'verify'='verify')=>({run_id:R,window_id:W,participant_id:P,user_id:U,operation,reservation_id:V,approved_plan_hash:plan});
const context=():ControlledTeamContext=>({mode:'controlled',run_id:R,window_id:W,owner_user_id:R,account_id:R,company_id:R,team_id:R,participant_id:P,approved_plan_hash:plan,server_now:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),personal_deadline_at:new Date(Date.now()+1200000).toISOString()});
const verification=():ControlledTeamW2Verification=>({verification_id:V,run_id:R,window_id:W,participant_id:P,user_id:U,invitation_hash:invitation});
const proof=():ControlledTeamW2Proof=>({runId:R,windowId:W,teamId:R,participantId:P,userId:U,email,invitationHash:invitation,tokenHash:token,type:'magiclink',issuedAt:Date.now(),expires:Date.now()+1200000});
const effect=():ControlledTeamW2Access=>({reservation_id:V,run_id:R,window_id:W,team_id:R,participant_id:P,user_id:U,report_id:null,recipient_email:email,invitation_hash:invitation,display_name:'Synthetic',create_user:false,server_now:new Date().toISOString(),deadline_at:new Date(Date.now()+60000).toISOString()});
function fakeRPC(operation:'issue'|'verify'='verify'){
 return vi.fn<(name:string,args:Record<string,unknown>)=>Promise<unknown>>(async(name,args)=>{
  if(name==='check_controlled_team_auth_evidence_key')return {...scope(operation),matched:true,server_now:new Date().toISOString()};
  if(name==='begin_controlled_team_auth_wire')return {...scope(operation),trace_id:T,admitted:true,status:'reserved',server_now:new Date().toISOString(),credential_match:operation==='issue'?null:true};
  if(name==='finish_controlled_team_auth_wire')return {...scope(operation),trace_id:T,status:args.p_outcome,credential_match:args.p_outcome==='succeeded',dispatched_at:args.p_dispatched_at,received_at:args.p_received_at,http_status:args.p_http_status,response_identity_matches:args.p_response_identity_matches};
  throw Error('unexpected_rpc');
 });
}
const url='https://fhvxqeaujjeiflanqsbg.supabase.co/auth/v1/verify';
const request=()=>({method:'POST',body:JSON.stringify({type:'magiclink',token_hash:token,gotrue_meta_security:{}})});
const successfulResponse=()=>new Response(JSON.stringify({user:{id:U,email,email_confirmed_at:'2026-10-24T15:00:00Z'},access_token:'sentinel-private-JWT',refresh_token:'sentinel-private-refresh'}));
beforeEach(()=>vi.useFakeTimers({now:new Date('2026-10-24T15:00:00Z')}));
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('private Auth evidence and actual wire interval',()=>{
 it('binds the actual token using an existing Authorization secret without sending that token/key to RPC',async()=>{
  const rpc=fakeRPC(),e=createAuthWireEvidence(binding(),{authorization,rpc});
  await e.begin(token);await e.finish({dispatchedAt:new Date().toISOString(),receivedAt:new Date().toISOString(),httpStatus:200,outcome:'succeeded',tokenHash:token,responseIdentityMatches:true});
  expect(rpc.mock.calls.map(c=>c[0])).toEqual(['check_controlled_team_auth_evidence_key','begin_controlled_team_auth_wire','finish_controlled_team_auth_wire']);
  expect(rpc.mock.calls[1][1].p_credential_mac).toBe(authCredentialMAC(binding(),authorization,token));
  const persisted=JSON.stringify(rpc.mock.calls);for(const sentinel of [authorization,token,email,'sentinel-private-JWT','sentinel-private-refresh'])expect(persisted).not.toContain(sentinel);
  expect(persisted).not.toContain('p_token_hash');
 });
 it('domain separates challenge/credential, includes identity/scope, and preserves issue→verify credential continuity',()=>{
  const mac=authCredentialMAC(binding(),authorization,token);
  expect(mac).toMatch(/^[a-f0-9]{64}$/);expect(mac).toBe(authCredentialMAC(binding('issue'),authorization,token));
  expect(mac).not.toBe(authCredentialMAC({...binding(),userId:R},authorization,token));
  expect(mac).not.toBe(authCredentialMAC(binding(),'Bearer different-synthetic-existing-key',token));
  expect(mac).not.toBe(authChallengeMAC(binding(),authorization,'d'.repeat(64)));
  expect(()=>authCredentialMAC(binding(),authorization,'short-OTP')).toThrow();
 });
 it.each(['mismatch','wrong_scope','malformed','private_error'])('fails before Auth HTTP when the header correspondence proof is %s',async(kind)=>{
  const rpc=fakeRPC();rpc.mockImplementationOnce(async()=>{if(kind==='private_error')throw Error(token+authorization);return kind==='malformed'?{}:{...scope(),matched:kind!=='mismatch',...(kind==='wrong_scope'?{user_id:R}:{}),server_now:new Date().toISOString()};});
  const actual=vi.fn<typeof fetch>(),e=createAuthWireEvidence(binding(),{authorization,rpc});
  await expect(controlledTeamW2VerifyFetch(context(),verification(),proof(),actual,e)(url,request())).rejects.toThrow('controlled_team_auth_evidence_unavailable');
  expect(actual).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledOnce();await expect(e.begin(token)).rejects.toThrow('unavailable');
 });
 it('refuses a blocked credential equality receipt before wire',async()=>{
  const rpc=fakeRPC();rpc.mockImplementationOnce(async()=>({...scope(),matched:true,server_now:new Date().toISOString()})).mockImplementationOnce(async()=>({...scope(),trace_id:T,admitted:false,status:'blocked',server_now:new Date().toISOString(),credential_match:false}));
  const actual=vi.fn<typeof fetch>(),e=createAuthWireEvidence(binding(),{authorization,rpc});
  await expect(controlledTeamW2VerifyFetch(context(),verification(),proof(),actual,e)(url,request())).rejects.toThrow('unavailable');expect(actual).not.toHaveBeenCalled();
 });
 it('records fetch dispatch/header response rather than broader RPC times and returns the original Response',async()=>{
  const rpc=fakeRPC(),e=createAuthWireEvidence(binding(),{authorization,rpc}),response=successfulResponse();
  rpc.mockImplementationOnce(async()=>{vi.advanceTimersByTime(1000);return {...scope(),matched:true,server_now:new Date().toISOString()};}).mockImplementationOnce(async()=>{vi.advanceTimersByTime(1000);return {...scope(),trace_id:T,admitted:true,status:'reserved',server_now:new Date().toISOString(),credential_match:true};});
  const actual=vi.fn<typeof fetch>().mockImplementation(async()=>{vi.advanceTimersByTime(500);return response;});
  expect(await controlledTeamW2VerifyFetch(context(),verification(),proof(),actual,e)(url,request())).toBe(response);
  expect(rpc.mock.calls[2][1]).toMatchObject({p_dispatched_at:'2026-10-24T15:00:02.000Z',p_received_at:'2026-10-24T15:00:02.500Z',p_http_status:200,p_outcome:'succeeded',p_response_identity_matches:true});
  expect(JSON.stringify(rpc.mock.calls)).not.toContain(token);
 });
 it('accepts equivalent RPC UTC serialization without rewriting stored timestamps',async()=>{
  const rpc=fakeRPC();const base=rpc.getMockImplementation()!;rpc.mockImplementation(async(n,a)=>{const r=await base(n,a) as Record<string,unknown>;if(n==='finish_controlled_team_auth_wire')return {...r,dispatched_at:String(a.p_dispatched_at).replace('Z','+00:00'),received_at:String(a.p_received_at).replace('Z','+00:00')};return r;});
  await controlledTeamW2VerifyFetch(context(),verification(),proof(),vi.fn<typeof fetch>().mockResolvedValue(successfulResponse()),createAuthWireEvidence(binding(),{authorization,rpc}))(url,request());
 });
 it('claims locally before awaits: concurrent verify calls cause exactly one HTTP',async()=>{
  const rpc=fakeRPC(),actual=vi.fn<typeof fetch>().mockResolvedValue(successfulResponse()),guard=controlledTeamW2VerifyFetch(context(),verification(),proof(),actual,createAuthWireEvidence(binding(),{authorization,rpc}));
  const results=await Promise.allSettled([guard(url,request()),guard(url,request())]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(actual).toHaveBeenCalledOnce();
 });
 it.each(['timeout','wrong_uid','malformed','http_error'])('keeps %s spent with safe trace and no retry',async(kind)=>{
  const rpc=fakeRPC(),actual=vi.fn<typeof fetch>().mockImplementation(async()=>{if(kind==='timeout')throw Error(token+authorization);if(kind==='malformed')return new Response('sentinel-private-raw-body');if(kind==='http_error')return new Response(token,{status:503});return new Response(JSON.stringify({user:{id:R,email,email_confirmed_at:'confirmed'}}));});
  const guard=controlledTeamW2VerifyFetch(context(),verification(),proof(),actual,createAuthWireEvidence(binding(),{authorization,rpc}));
  await expect(guard(url,request())).rejects.toThrow('unavailable');await expect(guard(url,request())).rejects.toThrow('dispatch_spent');expect(actual).toHaveBeenCalledOnce();
  const finish=rpc.mock.calls.find(c=>c[0]==='finish_controlled_team_auth_wire')!;expect(finish[1].p_outcome).not.toBe('succeeded');expect(JSON.stringify(rpc.mock.calls)).not.toContain(token);expect(JSON.stringify(rpc.mock.calls)).not.toContain('sentinel-private-raw-body');
 });
 it('never retries an unknown finish write after the actual successful HTTP',async()=>{
  const rpc=fakeRPC(),base=rpc.getMockImplementation()!;rpc.mockImplementation(async(n,a)=>{if(n==='finish_controlled_team_auth_wire')throw Error('private write outcome');return base(n,a);});
  const actual=vi.fn<typeof fetch>().mockResolvedValue(successfulResponse()),guard=controlledTeamW2VerifyFetch(context(),verification(),proof(),actual,createAuthWireEvidence(binding(),{authorization,rpc}));
  await expect(guard(url,request())).rejects.toThrow('unavailable');expect(rpc.mock.calls.filter(c=>c[0]==='finish_controlled_team_auth_wire')).toHaveLength(1);expect(actual).toHaveBeenCalledOnce();
 });
 it('bounds a stalled actual Auth dispatch at fifteen seconds and keeps its unknown reservation spent',async()=>{
  const rpc=fakeRPC();let signal:AbortSignal|undefined;
  const actual=vi.fn<typeof fetch>().mockImplementation(async(_input,init)=>{signal=init?.signal as AbortSignal;return await new Promise<Response>(()=>{});});
  const guard=controlledTeamW2VerifyFetch(context(),verification(),proof(),actual,createAuthWireEvidence(binding(),{authorization,rpc}));
  const result=guard(url,request()).catch(e=>e as Error);
  await vi.advanceTimersByTimeAsync(15001);
  const error=await result;expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe('controlled_team_auth_evidence_unavailable');expect(signal?.aborted).toBe(true);expect(actual).toHaveBeenCalledOnce();
  expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_outcome:'unknown',p_received_at:null,p_http_status:null,p_credential_mac:null});
  await expect(guard(url,request())).rejects.toThrow('dispatch_spent');expect(actual).toHaveBeenCalledOnce();
 });
 it('terminalizes a durable trace when the deadline expires during admission, without inventing a dispatch timestamp',async()=>{
  const begin=vi.fn<AuthWireEvidence['begin']>(async()=>{vi.advanceTimersByTime(1200001);}),finish=vi.fn<AuthWireEvidence['finish']>(async()=>{}),actual=vi.fn<typeof fetch>();
  const guard=controlledTeamW2VerifyFetch(context(),verification(),proof(),actual,{begin,finish});
  await expect(guard(url,request())).rejects.toThrow('unavailable');expect(actual).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledExactlyOnceWith({dispatchedAt:null,receivedAt:null,httpStatus:null,outcome:'failed',tokenHash:null,responseIdentityMatches:false});
  await expect(guard(url,request())).rejects.toThrow('dispatch_spent');expect(finish).toHaveBeenCalledOnce();
 });
 it('requires issuance trace success before exposing a provider response to canonical recovery/email code',async()=>{
  const rpc=fakeRPC('issue'),e=createAuthWireEvidence(binding('issue'),{authorization,rpc});
  const response=new Response(JSON.stringify({id:U,email,verification_type:'magiclink',hashed_token:token,email_otp:'sentinel-private-OTP',action_link:'sentinel-private-link'}));
  const actual=vi.fn<typeof fetch>().mockResolvedValue(response),guard=controlledTeamAuthFetch(effect(),invitation,actual,e);
  expect(await guard('https://fhvxqeaujjeiflanqsbg.supabase.co/auth/v1/admin/generate_link?redirect_to=https%3A%2F%2Faudit.iteam.ru%2Fru%2Fteam%2Fjoin',{method:'POST',body:JSON.stringify({type:'magiclink',email,redirectTo:'https://audit.iteam.ru/ru/team/join'})})).toBe(response);
  expect(rpc.mock.calls[2][1].p_credential_mac).toBe(authCredentialMAC(binding(),authorization,token));expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/sentinel-private-(OTP|link)/);
 });
 it('no observer credential token/hash/header/body is needed in a trace port',async()=>{
  const begin=vi.fn<AuthWireEvidence['begin']>(async()=>{}),finish=vi.fn<AuthWireEvidence['finish']>(async()=>{}),e:AuthWireEvidence={begin,finish};
  await controlledTeamW2VerifyFetch(context(),verification(),proof(),vi.fn<typeof fetch>().mockResolvedValue(successfulResponse()),e)(url,request());
  expect(begin).toHaveBeenCalledWith(token); // private in-process boundary only
  expect(finish.mock.calls[0][0]).toMatchObject({outcome:'succeeded',responseIdentityMatches:true});
 });
 it('caps private response parsing and sanitizes malformed response errors',async()=>{
  await expect(readAuthWireJSON(new Response('x'.repeat(65537)))).rejects.toThrow('controlled_team_auth_evidence_unavailable');
  await expect(readAuthWireJSON(new Response('sentinel-private-invalid'))).rejects.toThrow('controlled_team_auth_evidence_unavailable');
 });
 it('the default deployed/standalone RPC adapter is finite, one-fetch, and passes no usable credential body',async()=>{
  for(const [k,v]of Object.entries({APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable',AUTH_FLOW_SECRET:'synthetic-existing-auth-flow-secret-long-enough',SUPABASE_SERVICE_ROLE_KEY:authorization.slice(7)}))vi.stubEnv(k,v);
  const rpc=fakeRPC(),transport=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
   expect(String(input)).toMatch(/^https:\/\/fhvxqeaujjeiflanqsbg\.supabase\.co\/rest\/v1\/rpc\/(check_controlled_team_auth_evidence_key|begin_controlled_team_auth_wire|finish_controlled_team_auth_wire)$/);
   expect(init).toMatchObject({method:'POST',redirect:'error',cache:'no-store'});
   expect(String(init?.body)).not.toContain(token);expect(String(init?.body)).not.toContain(authorization);
   return new Response(JSON.stringify(await rpc(String(input).split('/').at(-1)!,JSON.parse(String(init?.body)))));
  });vi.stubGlobal('fetch',transport);
  const evidence=createAuthWireEvidence(binding());await evidence.begin(token);
  await evidence.finish({dispatchedAt:new Date().toISOString(),receivedAt:new Date().toISOString(),httpStatus:200,outcome:'succeeded',tokenHash:token,responseIdentityMatches:true});
  expect(transport).toHaveBeenCalledTimes(3);
 });
 it('a default RPC rejection does not expose a provider error or retry a request',async()=>{
  for(const [k,v]of Object.entries({APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable',AUTH_FLOW_SECRET:'synthetic-existing-auth-flow-secret-long-enough',SUPABASE_SERVICE_ROLE_KEY:authorization.slice(7)}))vi.stubEnv(k,v);
  const rpc=vi.fn<typeof fetch>().mockResolvedValue(new Response(token+authorization,{status:500}));vi.stubGlobal('fetch',rpc);
  const e=createAuthWireEvidence(binding());
  const err=await e.begin(token).catch(error=>error as Error);
  expect(err).toBeInstanceOf(Error);expect((err as Error).message).toBe('controlled_team_auth_evidence_unavailable');expect(rpc).toHaveBeenCalledOnce();
 });
});
