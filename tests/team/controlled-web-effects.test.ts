import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/server-runtime/supabase/admin',()=>({createAdminClient:()=>({rpc:s.rpc})}));
import {controlledTeamRequired,controlledTeamContext,reserveControlledTeamEffect,controlledTeamMillisecondsRemaining} from '@/server-runtime/team-smoke';
import {getTeamInvitationProvider} from '@/server/team/invitation-email';
const id='10000000-0000-4000-8000-000000000001',hash='a'.repeat(64),email='participant@example.test';
const context=()=>({mode:'controlled' as const,run_id:id,owner_user_id:id,account_id:id,company_id:id,team_id:id,participant_id:id,server_now:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString()});
const reservation=()=>({reservation_id:id,run_id:id,team_id:id,participant_id:id,report_id:null,recipient_email:email,invitation_hash:hash,server_now:new Date().toISOString(),deadline_at:new Date(Date.now()+60000).toISOString()});
const bound=async()=>{const result=await controlledTeamContext({teamId:id});if(!result)throw Error('test_context');return result;};
beforeEach(()=>{
 vi.clearAllMocks();vi.useFakeTimers({now:new Date('2026-10-23T19:00:00Z')});
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('APP_URL','https://audit.iteam.ru');vi.stubEnv('SUPABASE_URL','https://fhvxqeaujjeiflanqsbg.supabase.co');
 vi.stubEnv('TEAM_INVITATION_EMAIL_PROVIDER','resend');vi.stubEnv('RESEND_API_KEY','synthetic-no-real-key');vi.stubEnv('EMAIL_FROM','Audit <audit@example.test>');
 s.rpc.mockImplementation(async(name,args)=>({data:name==='controlled_team_context'?context():name==='reserve_controlled_team_effect'?reservation():{status:args.p_status},error:null}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});
describe('controlled Team web boundary',()=>{
 it('production requires the exact pair; partial production configuration fails closed',()=>{
  expect(controlledTeamRequired()).toBe(true);
  expect(controlledTeamRequired({APP_URL:'https://staging.example.test',SUPABASE_URL:'https://other.supabase.co'})).toBe(false);
  expect(()=>controlledTeamRequired({NODE_ENV:'production',APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://other.supabase.co'})).toThrow('controlled_team_unavailable');
 });
 it('requires fresh exact identity binding and never sends after an expired/mismatched context',async()=>{
  await expect(controlledTeamContext({teamId:id,ownerUserId:id})).resolves.toMatchObject({mode:'controlled'});
  s.rpc.mockResolvedValueOnce({data:{...context(),owner_user_id:'20000000-0000-4000-8000-000000000002'},error:null});
  await expect(controlledTeamContext({teamId:id,ownerUserId:id})).rejects.toThrow('controlled_team_unavailable');
  s.rpc.mockResolvedValueOnce({data:{...context(),expires_at:new Date().toISOString()},error:null});
  await expect(controlledTeamContext({teamId:id})).rejects.toThrow('controlled_team_unavailable');
 });
 it('accepts the actual additive SQL v1 shape with explicitly null W2 fields',async()=>{
  s.rpc.mockResolvedValueOnce({data:{...context(),window_id:null,continuation_window_id:null,personal_deadline_at:null,approved_plan_hash:null},error:null});
  await expect(controlledTeamContext({teamId:id})).resolves.toMatchObject({run_id:id,window_id:null,approved_plan_hash:null});
 });
 it('a consumed reservation cannot issue any external dispatch',async()=>{
  const ctx=await bound();
  s.rpc.mockResolvedValueOnce({data:null,error:{message:'already spent'}});
  const actual=vi.fn();vi.stubGlobal('fetch',actual);
  const provider=getTeamInvitationProvider({context:ctx,participantId:id,invitationHash:hash,recipient:email});
  await expect(provider.send({to:email,subject:'Synthetic',text:'Synthetic',idempotencyKey:`team-invitation/${id}/${hash}`})).rejects.toThrow('controlled_team_budget_consumed');
  expect(actual).not.toHaveBeenCalled();
 });
 it('Resend dispatch is fixed, reserved once, and never retried on uncertain transport',async()=>{
  const ctx=await bound();
  let reserved=false;
  s.rpc.mockImplementation(async(name,args)=>{
   if(name==='reserve_controlled_team_effect'){if(reserved)return {data:null,error:{message:'spent'}};reserved=true;return {data:reservation(),error:null};}
   return {data:{status:args.p_status},error:null};
  });
  const actual=vi.fn<typeof fetch>().mockRejectedValue(Error('sensitive synthetic error'));vi.stubGlobal('fetch',actual);
  const provider=getTeamInvitationProvider({context:ctx,participantId:id,invitationHash:hash,recipient:email}),message={to:email,subject:'Synthetic',text:'Synthetic',idempotencyKey:`team-invitation/${id}/${hash}`};
  await expect(provider.send(message)).rejects.toMatchObject({code:'team_delivery_unconfirmed',retryable:false});
  await expect(provider.send(message)).rejects.toThrow('controlled_team_budget_consumed');
  expect(actual).toHaveBeenCalledOnce();
  expect(actual.mock.calls[0][0]).toBe('https://api.resend.com/emails');
  expect(actual.mock.calls[0][1]).toMatchObject({method:'POST',redirect:'error',cache:'no-store'});
  expect(s.rpc).toHaveBeenCalledWith('complete_controlled_team_effect',{p_reservation_id:id,p_status:'unknown',p_provider_reference:null});
 });
 it('a DB bound recipient/hash mismatch cannot send even with a forged owner argument',async()=>{
  const ctx=await bound();
  const actual=vi.fn();vi.stubGlobal('fetch',actual);
  s.rpc.mockResolvedValueOnce({data:{...reservation(),recipient_email:'other@example.test'},error:null});
  const provider=getTeamInvitationProvider({context:ctx,participantId:id,invitationHash:hash,recipient:email});
  await expect(provider.send({to:email,subject:'Synthetic',text:'Synthetic',idempotencyKey:`team-invitation/${id}/${hash}`})).rejects.toThrow('team_message_invalid');
  expect(actual).not.toHaveBeenCalled();
 });
 it('a valid provider receipt is recorded without exposing the mail body or credentials',async()=>{
  const ctx=await bound();
  const actual=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({id:'synthetic-receipt'}),{status:200}));vi.stubGlobal('fetch',actual);
  const provider=getTeamInvitationProvider({context:ctx,participantId:id,invitationHash:hash,recipient:email});
  await expect(provider.send({to:email,subject:'Synthetic',text:'Synthetic private link',idempotencyKey:`team-invitation/${id}/${hash}`})).resolves.toEqual({providerMessageId:'synthetic-receipt'});
  expect(s.rpc).toHaveBeenCalledWith('complete_controlled_team_effect',{p_reservation_id:id,p_status:'succeeded',p_provider_reference:'synthetic-receipt'});
  expect(JSON.stringify(s.rpc.mock.calls)).not.toContain('Synthetic private link');
 });
 it('controlled production cannot silently choose mock or an unbound provider',()=>{
  expect(()=>getTeamInvitationProvider()).toThrow('controlled_team_unavailable');
  vi.stubEnv('TEAM_INVITATION_EMAIL_PROVIDER','mock');
  expect(()=>getTeamInvitationProvider({context:context(),participantId:id,invitationHash:hash,recipient:email})).toThrow('controlled_team_unavailable');
 });
 it('PDF reservations are exact report-bound and reject unexpected participant identity fields',async()=>{
  const ctx=await bound();
  s.rpc.mockResolvedValueOnce({data:{...reservation(),participant_id:null,report_id:id,recipient_email:null,invitation_hash:null},error:null});
  await expect(reserveControlledTeamEffect(ctx,'pdf',{reportId:id})).resolves.toMatchObject({report_id:id});
  s.rpc.mockResolvedValueOnce({data:{...reservation(),participant_id:null,report_id:id},error:null});
  await expect(reserveControlledTeamEffect(ctx,'pdf',{reportId:id})).rejects.toThrow('controlled_team_unavailable');
 });
 it('a local wall-clock rollback cannot extend the fresh DB-relative monotonic window',async()=>{
  const ctx=await bound(),actual=vi.fn();vi.stubGlobal('fetch',actual);
  vi.setSystemTime(new Date(Date.now()-60*60*1000));vi.advanceTimersByTime(60001);
  const provider=getTeamInvitationProvider({context:ctx,participantId:id,invitationHash:hash,recipient:email});
  await expect(provider.send({to:email,subject:'Synthetic',text:'Synthetic',idempotencyKey:`team-invitation/${id}/${hash}`})).rejects.toThrow('controlled_team_unavailable');
  expect(actual).not.toHaveBeenCalled();
 });
 it('subtracts the whole RPC round trip from the server-relative deadline',async()=>{
  const response=context();
  s.rpc.mockImplementationOnce(async()=>{vi.advanceTimersByTime(5000);return {data:response,error:null};});
  const ctx=await bound();
  expect(controlledTeamMillisecondsRemaining(ctx)).toBeLessThanOrEqual(55000);
  vi.setSystemTime(new Date(Date.now()-3600000));vi.advanceTimersByTime(55001);
  await expect(reserveControlledTeamEffect(ctx,'auth_link',{participantId:id})).rejects.toThrow('controlled_team_unavailable');
 });
});
