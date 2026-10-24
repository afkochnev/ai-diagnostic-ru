import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({context:vi.fn(),rpc:vi.fn(),cookies:vi.fn(),set:vi.fn(),origin:vi.fn(),foundation:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/server-runtime/team-smoke',()=>({controlledTeamContext:s.context}));
vi.mock('@/server-runtime/supabase/admin',()=>({createAdminClient:()=>({rpc:s.rpc})}));
vi.mock('@/server/supabase/config',()=>({authConfig:()=>({APP_URL:'https://audit.iteam.ru',AUTH_FLOW_SECRET:'synthetic-only-secret',secure:true})}));
vi.mock('@/server/team/capabilities',()=>({teamFoundationEnabled:s.foundation}));
vi.mock('next/headers',()=>({cookies:s.cookies,headers:async()=>({get:s.origin})}));
import {sealControlledTeamW2Proof} from '@/server-runtime/team-w2-proof';
import {readControlledTeamW2Entry} from '@/server/team/w2-entry';
import {prepareControlledTeamAccessAction} from '@/server/team/w2-entry-actions';
const root='10000000-0000-4000-8000-000000000001',windowId='20000000-0000-4000-8000-000000000002',participantId='30000000-0000-4000-8000-000000000003',uid='40000000-0000-4000-8000-000000000004',hash='a'.repeat(64),email='participant@example.test',tokenHash='b'.repeat(64),secret='synthetic-only-secret';
const proof=()=>({runId:root,windowId,teamId:root,participantId,userId:uid,email,invitationHash:hash,tokenHash,type:'magiclink' as const});
const ctx=()=>({run_id:root,window_id:windowId,team_id:root,personal_deadline_at:new Date(Date.now()+1200000).toISOString()});
const envelope=()=>sealControlledTeamW2Proof(proof(),secret,Date.now()+1200000);
beforeEach(()=>{
 vi.clearAllMocks();vi.useFakeTimers({now:new Date('2026-10-24T15:00:00Z')});s.context.mockResolvedValue(ctx());s.rpc.mockResolvedValue({data:{email,display_name:'Participant',user_id:uid,create_user:false},error:null});s.cookies.mockResolvedValue({set:s.set});s.origin.mockReturnValue('https://audit.iteam.ru');s.foundation.mockReturnValue(true);
});
afterEach(()=>vi.useRealTimers());
describe('W2 sealed entry uses exact pending UID/hash without token reconstruction',()=>{
 it('opens fresh proof with read-only target checks and no nonce reservation/credential HTTP',async()=>{
  await expect(readControlledTeamW2Entry(envelope(),secret)).resolves.toMatchObject({proof:proof(),target:{user_id:uid,create_user:false}});
  expect(s.context).toHaveBeenCalledExactlyOnceWith({windowId,participantId,invitationHash:hash});
  expect(s.rpc).toHaveBeenCalledExactlyOnceWith('resolve_team_invitation_auth',{p_token_hash:hash});
 });
 it.each(['stopped','wrong_root','wrong_team','personal_deadline','wrong_uid','create_user'])('refuses %s before setting any entry cookie',async(kind)=>{
  if(kind==='stopped')s.context.mockRejectedValue(Error('closed'));else if(kind==='wrong_root'||kind==='wrong_team'||kind==='personal_deadline')s.context.mockResolvedValue({...ctx(),...(kind==='wrong_root'?{run_id:uid}:kind==='wrong_team'?{team_id:uid}:{personal_deadline_at:new Date(Date.now()-1).toISOString()})});else s.rpc.mockResolvedValue({data:{email,display_name:'Participant',user_id:kind==='wrong_uid'?root:uid,create_user:kind==='create_user'},error:null});
  const form=new FormData();form.set('access',envelope());const result=await prepareControlledTeamAccessAction({},form);
  expect(result.error).toBeTruthy();expect(result.error).not.toContain(tokenHash);expect(s.set).not.toHaveBeenCalled();
 });
 it('preparation clears legacy contexts and stores a strict HttpOnly W2 proof without consuming consent',async()=>{
  const access=envelope(),form=new FormData();form.set('access',access);
  expect(await prepareControlledTeamAccessAction({},form)).toEqual({status:'prepared'});
  expect(s.set).toHaveBeenLastCalledWith('team-w2-access',access,{httpOnly:true,sameSite:'lax',secure:true,path:'/ru/team',maxAge:1200});
  expect(s.rpc).toHaveBeenCalledOnce();expect(s.rpc.mock.calls[0][0]).not.toContain('verification');
 });
 it.each(['origin','foundation'])('fails closed at %s without reading target or consuming anything',async(kind)=>{
  if(kind==='origin')s.origin.mockReturnValue('https://other.example.test');else s.foundation.mockReturnValue(false);
  const form=new FormData();form.set('access',envelope());expect((await prepareControlledTeamAccessAction({},form)).error).toBeTruthy();expect(s.context).not.toHaveBeenCalled();expect(s.rpc).not.toHaveBeenCalled();expect(s.set).not.toHaveBeenCalled();
 });
});
