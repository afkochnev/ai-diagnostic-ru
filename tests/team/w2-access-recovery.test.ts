import {createClient} from '@supabase/supabase-js';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {sealInvitationAuthProof,openInvitationAuthProof} from '@/server/team/invitation-auth-proof';
const s=vi.hoisted(()=>({rpc:vi.fn(),events:[] as string[],spent:new Set<string>()}));
vi.mock('server-only',()=>({}));
vi.mock('@/server-runtime/supabase/admin',()=>({createAdminClient:(fetchOverride?:typeof fetch)=>({rpc:s.rpc,auth:createClient('https://fhvxqeaujjeiflanqsbg.supabase.co','synthetic-key-only',{auth:{autoRefreshToken:false,persistSession:false},global:{fetch:fetchOverride??globalThis.fetch}}).auth})}));
import {recoverControlledTeamAccess} from '@/server-runtime/team-w2-access';
import {controlledTeamContext,reserveControlledTeamEffect,reserveControlledTeamW2Verification,controlledTeamPersonalMillisecondsRemaining} from '@/server-runtime/team-smoke';
import {sealControlledTeamW2Proof,openControlledTeamW2Proof,controlledTeamW2ProofTtl} from '@/server-runtime/team-w2-proof';
const root='10000000-0000-4000-8000-000000000001',windowId='20000000-0000-4000-8000-000000000002',participantId='30000000-0000-4000-8000-000000000003',uid='40000000-0000-4000-8000-000000000004',hash='a'.repeat(64),tokenHash='b'.repeat(64),email='participant@example.test',secret='synthetic-secret-long-enough-no-real-key';
const ctx=()=>({mode:'controlled',run_id:root,window_id:windowId,continuation_window_id:windowId,owner_user_id:root,account_id:root,company_id:root,team_id:root,participant_id:participantId,server_now:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),personal_deadline_at:new Date(Date.now()+1200000).toISOString()});
const reservation=()=>({reservation_id:uid,run_id:root,window_id:windowId,team_id:root,participant_id:participantId,user_id:uid,recipient_email:email,email,display_name:'Synthetic participant',invitation_hash:hash,create_user:false,report_id:null,server_now:new Date().toISOString(),deadline_at:new Date(Date.now()+60000).toISOString()});
const authResponse=(userId=uid,type='magiclink')=>new Response(JSON.stringify({id:userId,email,hashed_token:tokenHash,verification_type:type,action_link:'https://not-returned.example.test',email_otp:'123456',redirect_to:'https://audit.iteam.ru/ru/team/join'}),{status:200,headers:{'Content-Type':'application/json'}});
function provider(){return vi.fn<typeof fetch>().mockImplementation(async(input)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(url.startsWith('https://fhvxqeaujjeiflanqsbg.supabase.co/')){s.events.push('auth-http');return authResponse();}if(url==='https://api.resend.com/emails'){s.events.push('email-http');return new Response(JSON.stringify({id:'synthetic-receipt'}),{status:200});}throw Error('unexpected-network-forbidden');});}
beforeEach(()=>{
 vi.useFakeTimers({now:new Date('2026-10-24T15:00:00Z')});vi.clearAllMocks();s.events=[];s.spent.clear();
 for(const [k,v]of Object.entries({NODE_ENV:'production',APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic-only',AUTH_FLOW_SECRET:secret,TEAM_ENABLED:'true',TEAM_INVITATION_EMAIL_PROVIDER:'resend',RESEND_API_KEY:'synthetic-only',EMAIL_FROM:'Audit <audit@example.test>'}))vi.stubEnv(k,v);
 s.rpc.mockImplementation(async(name,args)=>{
  if(name==='controlled_team_context'){s.events.push('context');return {data:ctx(),error:null};}
  if(name==='reserve_controlled_team_w2_access'){const key=`${args.p_window_id}/${args.p_participant_id}/${args.p_effect}`;s.events.push(`reserve-${args.p_effect}`);if(s.spent.has(key))return {data:null,error:{message:'spent'}};s.spent.add(key);return {data:reservation(),error:null};}
  if(name==='complete_controlled_team_effect'){s.events.push(`complete-${args.p_status}`);return {data:{status:args.p_status},error:null};}
  throw Error('unexpected-rpc-forbidden');
 });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('W2 recovery uses a new slot without resetting the stopped root',()=>{
 it('binds same UID/hash, reserves each dispatch first and returns no credential to operator',async()=>{
  const actual=provider();vi.stubGlobal('fetch',actual);
  const result=await recoverControlledTeamAccess({windowId,participantId});
  expect(result).toEqual({windowId,participantId,status:'succeeded'});
  expect(s.events).toEqual(['context','reserve-reauth_link','auth-http','complete-succeeded','reserve-access_email','email-http','complete-succeeded']);
  expect(actual).toHaveBeenCalledTimes(2);
  const authRequest=actual.mock.calls[0][0] as Request;
  expect(await authRequest.clone().json()).toEqual({type:'magiclink',email,redirectTo:'https://audit.iteam.ru/ru/team/join'});
  const send=actual.mock.calls[1][1]!;expect(send).toMatchObject({method:'POST',redirect:'error',cache:'no-store'});
  const message=JSON.parse(String(send.body));expect(message.to).toEqual([email]);
  const envelope=message.text.match(/#access=([A-Za-z0-9_-]+)/)?.[1];
  expect(openControlledTeamW2Proof(envelope,secret)).toMatchObject({runId:root,windowId,teamId:root,participantId,userId:uid,email,invitationHash:hash,tokenHash,type:'magiclink'});
  expect(JSON.stringify(result)).not.toContain(tokenHash);expect(JSON.stringify(s.rpc.mock.calls)).not.toContain(tokenHash);
  expect(s.rpc.mock.calls.map(([name])=>name)).not.toContain('reserve_team_invitation_identity');
  expect(s.rpc.mock.calls.map(([name])=>name)).not.toContain('renew_team_invitation');
  await expect(recoverControlledTeamAccess({windowId,participantId})).rejects.toThrow('budget_consumed');expect(actual).toHaveBeenCalledTimes(2);
 });
 it.each(['wrong_uid','wrong_type','unknown'])('consumes uncertain or mismatched Auth %s and never sends fallback email',async(kind)=>{
  const actual=vi.fn<typeof fetch>().mockImplementation(async()=>{if(kind==='unknown')throw Error('private provider response');return authResponse(kind==='wrong_uid'?root:uid,kind==='wrong_type'?'signup':'magiclink');});vi.stubGlobal('fetch',actual);
  await expect(recoverControlledTeamAccess({windowId,participantId})).rejects.toThrow('controlled_team_access_unconfirmed');
  await expect(recoverControlledTeamAccess({windowId,participantId})).rejects.toThrow('budget_consumed');
  expect(actual).toHaveBeenCalledOnce();expect(s.events).not.toContain('reserve-access_email');
  expect(s.rpc).toHaveBeenCalledWith('complete_controlled_team_effect',{p_reservation_id:uid,p_status:'unknown',p_provider_reference:null});
 });
 it.each(['timeout','malformed','non_2xx'])('never resends a dispatched email after %s',async(kind)=>{
  const actual=provider();actual.mockImplementationOnce(async()=>authResponse()).mockImplementationOnce(async()=>{if(kind==='timeout')throw Error('private sensitive failure');return new Response(kind==='malformed'?'{}':'rejected',{status:kind==='non_2xx'?503:200});});vi.stubGlobal('fetch',actual);
  await expect(recoverControlledTeamAccess({windowId,participantId})).rejects.toThrow('controlled_team_access_unconfirmed');
  await expect(recoverControlledTeamAccess({windowId,participantId})).rejects.toThrow('budget_consumed');
  expect(actual).toHaveBeenCalledTimes(2);expect(s.spent.size).toBe(2);
  // A mail failure never attempts to overwrite the already-successful Auth row.
  expect(s.events.filter(x=>x==='complete-succeeded')).toHaveLength(1);
 });
 it.each(['no_window','wrong_window','create_user','expired_personal'])('rejects %s before Auth network',async(kind)=>{
  const actual=provider();vi.stubGlobal('fetch',actual);
  if(kind==='create_user')s.rpc.mockResolvedValueOnce({data:ctx(),error:null}).mockResolvedValueOnce({data:{...reservation(),create_user:true},error:null});
  else s.rpc.mockResolvedValueOnce({data:{...ctx(),...(kind==='no_window'?{window_id:null,continuation_window_id:null}:kind==='wrong_window'?{window_id:root,continuation_window_id:root}:{personal_deadline_at:new Date(Date.now()-1).toISOString()})},error:null});
  await expect(recoverControlledTeamAccess({windowId,participantId})).rejects.toThrow();expect(actual).not.toHaveBeenCalled();
 });
 it('routes remaining PDF through the same root + explicit W2; refuses generic auth/invite slots',async()=>{
  const context=await controlledTeamContext({windowId,participantId});if(!context)throw Error('missing');
  await expect(reserveControlledTeamEffect(context,'auth_link',{participantId})).rejects.toThrow('unavailable');
  await expect(reserveControlledTeamEffect(context,'invitation_email',{participantId})).rejects.toThrow('unavailable');
  s.rpc.mockResolvedValueOnce({data:{...reservation(),participant_id:null,report_id:uid,recipient_email:null,invitation_hash:null},error:null});
  await reserveControlledTeamEffect(context,'pdf',{reportId:uid});
  expect(s.rpc).toHaveBeenLastCalledWith('reserve_controlled_team_window_effect',{p_run_id:root,p_window_id:windowId,p_team_id:root,p_effect:'pdf',p_participant_id:null,p_report_id:uid});
 });
 it('the personal20-minute cutoff uses the DB-relative monotonic clock even if local time rolls back',async()=>{
  const context=await controlledTeamContext({windowId,participantId});if(!context)throw Error('missing');
  vi.setSystemTime(new Date(Date.now()-3600000));vi.advanceTimersByTime(1200001);
  expect(controlledTeamPersonalMillisecondsRemaining(context)).toBeLessThanOrEqual(0);
  const before=s.rpc.mock.calls.length;
  await expect(reserveControlledTeamW2Verification(context,{participantId,userId:uid,invitationHash:hash})).rejects.toThrow('unavailable');
  expect(s.rpc).toHaveBeenCalledTimes(before);
 });
});
describe('fresh W2 proof purpose and immutable original issue time',()=>{
 const value={runId:root,windowId,teamId:root,participantId,userId:uid,email,invitationHash:hash,tokenHash,type:'magiclink' as const};
 it('never accepts old invitation credentials as W2 or W2 as old invitation',()=>{
  const old=sealInvitationAuthProof({email,invitationHash:hash,tokenHash,type:'invite'},secret);
  expect(openControlledTeamW2Proof(old,secret)).toBeNull();
  const w2=sealControlledTeamW2Proof(value,secret,Date.now()+controlledTeamW2ProofTtl);
  expect(openInvitationAuthProof(w2,hash,secret)).toBeNull();
 });
 it('enforces the earlier personal deadline, integrity and no clock rollback extension',()=>{
  const now=Date.now(),proof=sealControlledTeamW2Proof(value,secret,now+1200000);
  expect(openControlledTeamW2Proof(proof,secret,now+1199999)).toMatchObject(value);
  expect(openControlledTeamW2Proof(proof,secret,now+1200000)).toBeNull();
  expect(openControlledTeamW2Proof(proof,secret,now-1)).toBeNull();
  expect(openControlledTeamW2Proof(proof,'foreign-secret',now)).toBeNull();
  const bytes=Buffer.from(proof,'base64url');bytes[40]^=1;expect(openControlledTeamW2Proof(bytes.toString('base64url'),secret,now)).toBeNull();
 });
});
