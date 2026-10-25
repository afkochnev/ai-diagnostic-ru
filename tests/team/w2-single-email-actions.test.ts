import {beforeEach,describe,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({context:vi.fn(),current:vi.fn(),verify:vi.fn(),reserve:vi.fn(),transport:vi.fn(),rpc:vi.fn(),clear:vi.fn(),limit:vi.fn(),events:[] as string[]}));
vi.mock('server-only',()=>({}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw Error('redirect:'+url);}}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/server/team/entry-context',()=>({teamEntryContext:s.context,clearTeamEntry:s.clear}));
vi.mock('@/server/supabase/server',()=>({createAuthClient:async()=>({auth:{getUser:s.current,verifyOtp:s.verify}})}));
vi.mock('@/server/auth/legal',()=>({registrationPolicy:async()=>({versions:{data_processing:'data-processing-consent-ru-v1',marketing:'marketing-consent-ru-v1'}})}));
vi.mock('@/server/auth/recovery',()=>({clearRecovery:vi.fn()}));
vi.mock('@/server/team/service',()=>({teamRpc:s.rpc}));
vi.mock('@/server/rate-limit',()=>({enforceRateLimit:s.limit}));
vi.mock('@/server-runtime/team-smoke',()=>({reserveControlledTeamW2Verification:s.reserve}));
vi.mock('@/server/team/controlled-auth-transport',()=>({controlledTeamW2VerifyFetch:s.transport}));
import {continueSingleEmailAction} from '@/server/team/single-email-actions';
const root='10000000-0000-4000-8000-000000000001',windowId='20000000-0000-4000-8000-000000000002',participantId='30000000-0000-4000-8000-000000000003',uid='40000000-0000-4000-8000-000000000004',verificationId='50000000-0000-4000-8000-000000000005',hash='a'.repeat(64),email='participant@example.test',tokenHash='b'.repeat(64);
const proof={runId:root,windowId,teamId:root,participantId,userId:uid,email,invitationHash:hash,tokenHash,type:'magiclink'};
const context=()=>({token:'',hash,target:{email,user_id:uid,create_user:false},proof,w2:{proof,controlled:{run_id:root,window_id:windowId}}});
function consent(){const form=new FormData();form.set('data_processing_consent','on');form.set('data_processing_version','data-processing-consent-ru-v1');form.set('marketing_version','marketing-consent-ru-v1');return form;}
beforeEach(()=>{
 vi.clearAllMocks();s.events=[];s.context.mockResolvedValue(context());s.current.mockResolvedValue({data:{user:null}});
 s.limit.mockImplementation(async()=>{s.events.push('natural-rate');});
 s.reserve.mockImplementation(async()=>{s.events.push('reserve-personal');return {verification_id:verificationId};});
 s.transport.mockImplementation(()=>{s.events.push('guard-verify-transport');return vi.fn();});
 s.verify.mockImplementation(async()=>{s.events.push('verify');return {data:{session:{},user:{id:uid,email,email_confirmed_at:'confirmed'}},error:null};});
 s.rpc.mockImplementation(async()=>{s.events.push('finalize');return participantId;});
});
describe('W2 personal action is current consent first and one durable attempt',()=>{
 it('reserves on the actual consent action then verifies same UID and hash-finalizes without raw invitation',async()=>{
  await expect(continueSingleEmailAction({},consent())).rejects.toThrow('redirect:/ru/team/responses/'+participantId);
  expect(s.events).toEqual(['natural-rate','reserve-personal','guard-verify-transport','verify','finalize']);
  expect(s.reserve).toHaveBeenCalledWith(context().w2.controlled,{participantId,userId:uid,invitationHash:hash});
  expect(s.rpc).toHaveBeenCalledExactlyOnceWith('finalize_controlled_team_w2_identity',{p_window_id:windowId,p_verification_id:verificationId,p_invitation_hash:hash,p_consent:true,p_data_version:'data-processing-consent-ru-v1',p_marketing_version:'marketing-consent-ru-v1'});
  expect(s.verify).toHaveBeenCalledExactlyOnceWith({token_hash:tokenHash,type:'magiclink'});
  expect(JSON.stringify(s.rpc.mock.calls)).not.toContain(tokenHash);
 });
 it.each(['no_consent','old_version','marketing_true'])('rejects %s before reservation or Auth',async(kind)=>{
  const form=consent();if(kind==='no_consent')form.delete('data_processing_consent');if(kind==='old_version')form.set('data_processing_version','temporary-ru-v1');if(kind==='marketing_true')form.set('marketing_consent','on');
  expect((await continueSingleEmailAction({},form)).error).toBeTruthy();expect(s.reserve).not.toHaveBeenCalled();expect(s.verify).not.toHaveBeenCalled();expect(s.rpc).not.toHaveBeenCalled();
 });
 it('spent personal admission blocks Auth and never retries even with a still-valid proof',async()=>{
  s.reserve.mockRejectedValue(Error('controlled_team_budget_consumed'));
  expect((await continueSingleEmailAction({},consent())).phase).toBe('expired');expect(s.verify).not.toHaveBeenCalled();expect(s.rpc).not.toHaveBeenCalled();
 });
 it.each(['different_email','same_email_different_uid'])('rejects wrong existing browser %s before consuming personal attempt',async(kind)=>{
  s.current.mockResolvedValue({data:{user:{id:root,email:kind==='different_email'?'other@example.test':email,email_confirmed_at:'confirmed'}}});
  expect((await continueSingleEmailAction({},consent())).phase).toBe('wrong');expect(s.reserve).not.toHaveBeenCalled();expect(s.verify).not.toHaveBeenCalled();
 });
 it('a provider response with the correct email but another UID cannot finalize',async()=>{
  s.verify.mockResolvedValue({data:{session:{},user:{id:root,email,email_confirmed_at:'confirmed'}},error:null});
  expect((await continueSingleEmailAction({},consent())).phase).toBe('expired');expect(s.rpc).not.toHaveBeenCalled();
 });
 it('matching already-confirmed exact UID cannot bypass the required trace-backed personal verify',async()=>{
  s.current.mockResolvedValue({data:{user:{id:uid,email,email_confirmed_at:'confirmed'}}});
  expect((await continueSingleEmailAction({},consent())).phase).toBe('expired');expect(s.reserve).not.toHaveBeenCalled();expect(s.verify).not.toHaveBeenCalled();expect(s.rpc).not.toHaveBeenCalled();
 });
 it('a finalizer participant mismatch does not redirect or claim acceptance',async()=>{
  s.rpc.mockResolvedValue(root);expect((await continueSingleEmailAction({},consent())).phase).toBe('expired');
 });
});
