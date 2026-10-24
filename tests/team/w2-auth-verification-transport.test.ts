import {createClient} from '@supabase/supabase-js';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {controlledTeamW2VerifyFetch,controlledTeamAuthFetch} from '@/server/team/controlled-auth-transport';
import type {ControlledTeamContext,ControlledTeamW2Verification,ControlledTeamEffect} from '@/server-runtime/team-smoke';
import type {ControlledTeamW2Proof} from '@/server-runtime/team-w2-proof';
const root='10000000-0000-4000-8000-000000000001',windowId='20000000-0000-4000-8000-000000000002',participantId='30000000-0000-4000-8000-000000000003',uid='40000000-0000-4000-8000-000000000004',hash='a'.repeat(64),tokenHash='b'.repeat(64),email='participant@example.test';
const context=():ControlledTeamContext=>({mode:'controlled',run_id:root,window_id:windowId,owner_user_id:root,account_id:root,company_id:root,team_id:root,participant_id:participantId,server_now:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),personal_deadline_at:new Date(Date.now()+1200000).toISOString()});
const verification=():ControlledTeamW2Verification=>({verification_id:uid,run_id:root,window_id:windowId,participant_id:participantId,user_id:uid,invitation_hash:hash});
const proof=():ControlledTeamW2Proof=>({runId:root,windowId,teamId:root,participantId,userId:uid,email,invitationHash:hash,tokenHash,type:'magiclink',issuedAt:Date.now(),expires:Date.now()+1200000});
const url='https://fhvxqeaujjeiflanqsbg.supabase.co/auth/v1/verify',body={type:'magiclink',token_hash:tokenHash,gotrue_meta_security:{}};
beforeEach(()=>vi.useFakeTimers({now:new Date('2026-10-24T15:00:00Z')}));
afterEach(()=>vi.useRealTimers());
describe('W2 single reserved consent verification dispatch',()=>{
 it('allows exactly one HTTP and rejects local SDK re-dispatch after an unknown result',async()=>{
  const actual=vi.fn<typeof fetch>().mockRejectedValue(Error('synthetic ambiguous'));
  const guarded=controlledTeamW2VerifyFetch(context(),verification(),proof(),actual);
  await expect(guarded(url,{method:'POST',body:JSON.stringify(body)})).rejects.toThrow('synthetic');
  await expect(guarded(url,{method:'POST',body:JSON.stringify(body)})).rejects.toThrow('dispatch_spent');
  expect(actual).toHaveBeenCalledOnce();expect(actual.mock.calls[0][1]).toMatchObject({redirect:'error',cache:'no-store'});
 });
 it.each([
  ['https://foreign.example.test/auth/v1/verify','POST',body],
  [url+'?redirect_to=https://foreign.example.test','POST',body],
  [url,'GET',undefined],
  [url,'POST',{...body,type:'invite'}],
  [url,'POST',{...body,token_hash:'c'.repeat(64)}],
  [url,'POST',{...body,email}],
  [url,'POST',{...body,gotrue_meta_security:{captcha_token:'synthetic'}}],
  ['https://fhvxqeaujjeiflanqsbg.supabase.co/auth/v1/token','POST',body],
 ])('refuses request scope drift %# before wire',async(target,method,payload)=>{
  const actual=vi.fn<typeof fetch>(),guarded=controlledTeamW2VerifyFetch(context(),verification(),proof(),actual);
  await expect(guarded(target,{method,body:payload?JSON.stringify(payload):undefined})).rejects.toThrow('controlled_team_auth_scope');expect(actual).not.toHaveBeenCalled();
 });
 it.each(['window','user','root','hash'])('refuses %s reservation binding mismatch before network',kind=>{
  const wrong={...verification(),...(kind==='window'?{window_id:root}:kind==='user'?{user_id:root}:kind==='root'?{run_id:uid}:{invitation_hash:'c'.repeat(64)})};
  expect(()=>controlledTeamW2VerifyFetch(context(),wrong,proof(),vi.fn())).toThrow('controlled_team_unavailable');
 });
 it('applies personal deadline even while full60-minute window is active',async()=>{
  const actual=vi.fn<typeof fetch>(),guarded=controlledTeamW2VerifyFetch(context(),verification(),proof(),actual);vi.advanceTimersByTime(1200000);
  await expect(guarded(url,{method:'POST',body:JSON.stringify(body)})).rejects.toThrow('unavailable');expect(actual).not.toHaveBeenCalled();
 });
 it('installed SDK verifyOtp matches this finite transport and its failure cannot retry',async()=>{
  const actual=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({message:'synthetic rejection'}),{status:503,headers:{'Content-Type':'application/json'}}));
  const client=createClient('https://fhvxqeaujjeiflanqsbg.supabase.co','synthetic-only-key',{auth:{autoRefreshToken:false,persistSession:false},global:{fetch:controlledTeamW2VerifyFetch(context(),verification(),proof(),actual)}});
  const first=await client.auth.verifyOtp({type:'magiclink',token_hash:tokenHash});expect(first.error).toBeTruthy();expect(actual).toHaveBeenCalledOnce();
  const second=await client.auth.verifyOtp({type:'magiclink',token_hash:tokenHash});expect(second.error).toBeTruthy();expect(actual).toHaveBeenCalledOnce();
  expect(await (actual.mock.calls[0][0] as Request).clone().json()).toEqual(body);
 });
 it('W2 generate-link transport cannot change pending identity metadata or request a new invite',async()=>{
  const effect:ControlledTeamEffect={reservation_id:uid,run_id:root,window_id:windowId,participant_id:participantId,team_id:root,report_id:null,recipient_email:email,invitation_hash:hash,server_now:new Date().toISOString(),deadline_at:new Date(Date.now()+60000).toISOString()};
  const actual=vi.fn<typeof fetch>(),guarded=controlledTeamAuthFetch(effect,hash,actual),generate='https://fhvxqeaujjeiflanqsbg.supabase.co/auth/v1/admin/generate_link?redirect_to=https%3A%2F%2Faudit.iteam.ru%2Fru%2Fteam%2Fjoin';
  await expect(guarded(generate,{method:'POST',body:JSON.stringify({type:'invite',email,redirectTo:'https://audit.iteam.ru/ru/team/join',data:{team_pending_nonce:'c'.repeat(64)}})})).rejects.toThrow('scope');expect(actual).not.toHaveBeenCalled();
 });
});
