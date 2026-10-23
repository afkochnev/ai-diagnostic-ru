import {beforeEach,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({context:vi.fn(),effect:vi.fn(),complete:vi.fn(),identity:vi.fn(),generate:vi.fn(),events:[] as string[]}));
vi.mock('server-only',()=>({}));
vi.mock('@/server-runtime/team-smoke',()=>({controlledTeamContext:s.context,reserveControlledTeamEffect:s.effect,completeControlledTeamEffect:s.complete,assertControlledTeamEffectWindow:vi.fn()}));
vi.mock('@/server-runtime/supabase/admin',()=>({createAdminClient:()=>({rpc:s.identity,auth:{admin:{generateLink:s.generate}}})}));
vi.mock('@/server/team/controlled-auth-transport',()=>({controlledTeamAuthFetch:()=>vi.fn()}));
vi.mock('@/server/supabase/config',()=>({authConfig:()=>({APP_URL:'https://audit.iteam.ru',AUTH_FLOW_SECRET:'synthetic-secret-only'})}));
import {singleEmailCredential} from '@/server/team/single-email';
const id='10000000-0000-4000-8000-000000000001',hash='a'.repeat(64),email='controlled@example.test';
beforeEach(()=>{
 vi.clearAllMocks();s.events=[];let spent=false;
 s.context.mockImplementation(async()=>{s.events.push('context');return {participant_id:id,team_id:id};});
 s.effect.mockImplementation(async()=>{s.events.push('reserve-effect');if(spent)throw Error('controlled_team_budget_consumed');spent=true;return {reservation_id:id,participant_id:id,recipient_email:email,invitation_hash:hash};});
 s.identity.mockImplementation(async()=>{s.events.push('reserve-identity');return {data:{email,display_name:'Controlled',create_user:true},error:null};});
 s.generate.mockImplementation(async()=>{s.events.push('generate');return {data:{properties:{hashed_token:'b'.repeat(64),verification_type:'invite'},user:{email}},error:null};});
 s.complete.mockImplementation(async()=>{s.events.push('complete');});
});
it('reserves the durable recipient slot before any identity issuance and does not expose Auth proof to evidence',async()=>{
 const result=await singleEmailCredential(hash);
 expect(s.events).toEqual(['context','reserve-effect','reserve-identity','generate','complete']);
 expect(s.effect).toHaveBeenCalledWith({participant_id:id,team_id:id},'auth_link',{participantId:id});
 expect(result.email).toBe(email);expect(result.envelope).not.toContain('b'.repeat(64));
 expect(s.complete).toHaveBeenCalledWith(expect.any(Object),'succeeded');
 await expect(singleEmailCredential(hash)).rejects.toThrow('controlled_team_budget_consumed');
 expect(s.identity).toHaveBeenCalledOnce();expect(s.generate).toHaveBeenCalledOnce();
});
it('uncertain credential issuance consumes its slot and cannot generate a replacement',async()=>{
 s.generate.mockRejectedValueOnce(Error('private synthetic provider data'));
 await expect(singleEmailCredential(hash)).rejects.toThrow('team_auth_unavailable');
 expect(s.complete).toHaveBeenCalledWith(expect.any(Object),'unknown');
 await expect(singleEmailCredential(hash)).rejects.toThrow('controlled_team_budget_consumed');
 expect(s.generate).toHaveBeenCalledOnce();
});
it('a reservation/identity email mismatch cannot issue a credential',async()=>{
 s.identity.mockResolvedValueOnce({data:{email:'other@example.test',display_name:'Controlled',create_user:true},error:null});
 await expect(singleEmailCredential(hash)).rejects.toThrow('team_invitation_unavailable');
 expect(s.generate).not.toHaveBeenCalled();expect(s.complete).toHaveBeenCalledWith(expect.any(Object),'failed');
});
