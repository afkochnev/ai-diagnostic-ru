import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {controlledTeamAuthFetch} from '@/server/team/controlled-auth-transport';
import type {ControlledTeamEffect} from '@/server-runtime/team-smoke';
const hash='a'.repeat(64),participant='10000000-0000-4000-8000-000000000001',email='participant@example.test';
const effect=():ControlledTeamEffect=>({reservation_id:participant,run_id:participant,team_id:participant,participant_id:participant,report_id:null,recipient_email:email,invitation_hash:hash,server_now:new Date().toISOString(),deadline_at:new Date(Date.now()+60000).toISOString()});
const url='https://fhvxqeaujjeiflanqsbg.supabase.co/auth/v1/admin/generate_link?redirect_to=https%3A%2F%2Faudit.iteam.ru%2Fru%2Fteam%2Fjoin';
const body={type:'magiclink',email,redirectTo:'https://audit.iteam.ru/ru/team/join'};
beforeEach(()=>vi.useFakeTimers({now:new Date('2026-10-23T19:00:00Z')}));
afterEach(()=>vi.useRealTimers());
describe('one reserved Auth credential HTTP dispatch',()=>{
 it('pins host/path/query/recipient and refuses a second actual dispatch including after uncertainty',async()=>{
  const actual=vi.fn<typeof fetch>().mockRejectedValue(Error('synthetic connection error'));
  const transport=controlledTeamAuthFetch(effect(),hash,actual);
  await expect(transport(url,{method:'POST',body:JSON.stringify(body)})).rejects.toThrow('synthetic');
  await expect(transport(url,{method:'POST',body:JSON.stringify(body)})).rejects.toThrow('dispatch_spent');
  expect(actual).toHaveBeenCalledOnce();
  expect(actual.mock.calls[0][1]).toMatchObject({redirect:'error',cache:'no-store'});
 });
 it.each([
  ['https://foreign.example.test/auth/v1/admin/generate_link','POST',body],
  ['https://fhvxqeaujjeiflanqsbg.supabase.co/auth/v1/invite','POST',body],
  [url,'GET',undefined],
  [url,'POST',{...body,email:'foreign@example.test'}],
  [url,'POST',{...body,type:'recovery'}],
  [url,'POST',{...body,password:'not-allowed'}],
  [url,'POST',{...body,data:{data_processing_consent:true}}],
  [url+'&extra=1','POST',body]
 ])('denies scope drift before HTTP %#',async(target,method,payload)=>{
  const actual=vi.fn<typeof fetch>();
  const transport=controlledTeamAuthFetch(effect(),hash,actual);
  await expect(transport(target,{method,body:payload?JSON.stringify(payload):undefined})).rejects.toThrow('controlled_team_auth_scope');
  expect(actual).not.toHaveBeenCalled();
 });
 it('refuses expired reservations before HTTP',async()=>{
  const actual=vi.fn<typeof fetch>(),transport=controlledTeamAuthFetch(effect(),hash,actual);
  vi.advanceTimersByTime(60000);
  await expect(transport(url,{method:'POST',body:JSON.stringify(body)})).rejects.toThrow('controlled_team_unavailable');
  expect(actual).not.toHaveBeenCalled();
 });
 it('the installed Supabase SDK uses the guarded generate_link request and cannot retry a second dispatch',async()=>{
  const actual=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({id:participant,email,hashed_token:'b'.repeat(64),verification_type:'magiclink',action_link:'https://synthetic.invalid',email_otp:'123456',redirect_to:'https://audit.iteam.ru/ru/team/join'}),{status:200,headers:{'Content-Type':'application/json'}}));
  const client=createClient('https://fhvxqeaujjeiflanqsbg.supabase.co','synthetic-no-real-secret',{auth:{autoRefreshToken:false,persistSession:false},global:{fetch:controlledTeamAuthFetch(effect(),hash,actual)}});
  const first=await client.auth.admin.generateLink({type:'magiclink',email,options:{redirectTo:body.redirectTo}});
  expect(first.error).toBeNull();expect(first.data.user?.email).toBe(email);
  expect((actual.mock.calls[0][0] as Request).url).toBe(url);
  const second=await client.auth.admin.generateLink({type:'magiclink',email,options:{redirectTo:body.redirectTo}});
  expect(second.error).toBeTruthy();expect(actual).toHaveBeenCalledOnce();
 });
 it('new identity requests carry only a private nonce, with no fabricated consent or password',async()=>{
  const actual=vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
  const transport=controlledTeamAuthFetch(effect(),hash,actual);
  await transport(url,{method:'POST',body:JSON.stringify({...body,type:'invite',data:{team_pending_nonce:'f'.repeat(64)}})});
  expect(actual).toHaveBeenCalledOnce();
 });
 it('the installed SDK cannot automatically re-dispatch a provider 5xx',async()=>{
  const actual=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({message:'synthetic upstream failure'}),{status:503,headers:{'Content-Type':'application/json'}}));
  const client=createClient('https://fhvxqeaujjeiflanqsbg.supabase.co','synthetic-no-real-secret',{auth:{autoRefreshToken:false,persistSession:false},global:{fetch:controlledTeamAuthFetch(effect(),hash,actual)}});
  const result=await client.auth.admin.generateLink({type:'magiclink',email,options:{redirectTo:body.redirectTo}});
  expect(result.error).toBeTruthy();expect(actual).toHaveBeenCalledOnce();
 });
});
