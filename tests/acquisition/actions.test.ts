import {beforeEach,describe,it,expect,vi} from 'vitest';
const s=vi.hoisted(()=>({guard:vi.fn(),context:vi.fn(),rpc:vi.fn(),claim:vi.fn(),session:vi.fn(),request:vi.fn(),identity:vi.fn(),policy:vi.fn(),auth:vi.fn(),set:vi.fn(),clear:vi.fn(),jarGet:vi.fn(),cookieSet:vi.fn(),limit:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw Error('REDIRECT:'+url);}}));
vi.mock('next/headers',()=>({cookies:async()=>({get:s.jarGet,set:s.cookieSet})}));
vi.mock('@/server/acquisition/context',()=>({guardOrigin:s.guard,cookieContext:s.context,setContext:s.set,newSecret:()=> 'b'.repeat(64),hash:(x:string)=>'h:'+x,clearAnonymous:s.clear,limit:s.limit,ipLimit:vi.fn(),visitCookie:'aca-journey'}));
vi.mock('@/server/acquisition/service',()=>({sessionRpc:s.rpc,claimRpc:s.claim,ownSession:s.session}));
vi.mock('@/server/acquisition/email',()=>({requestAccess:s.request,accessProof:()=>({email:'synthetic@example.test',tokenHash:'token-hash',type:'magiclink'})}));
vi.mock('@/server/supabase/server',()=>({createAuthClient:async()=>({auth:s.auth()})}));
vi.mock('@/server/supabase/config',()=>({authConfig:()=>({APP_URL:'https://example.test',secure:true})}));
vi.mock('@/server/auth/session',()=>({getIdentity:s.identity}));
vi.mock('@/server/auth/legal',()=>({registrationPolicy:s.policy}));
import {startAnonymous,sendAccess,confirmAccess,finishClaim} from '@/server/acquisition/actions';
const form=(values:Record<string,string>)=>{const f=new FormData();Object.entries(values).forEach(([k,v])=>f.set(k,v));return f;};
beforeEach(()=>{vi.clearAllMocks();s.guard.mockResolvedValue(undefined);s.identity.mockResolvedValue(null);s.context.mockResolvedValue({id:'session',hash:'hash',secret:'secret'});s.policy.mockResolvedValue({versions:{data_processing:'current',marketing:'current'}});s.session.mockResolvedValue({consent_version:'current',marketing_version:'current'});s.rpc.mockResolvedValue({id:'new-session',consent_version:'current',marketing_version:'current'});s.request.mockResolvedValue(undefined);s.jarGet.mockImplementation((k:string)=>({value:k==='aca-access'?'envelope':'session'}));});
describe('V25 server actions preserve authority before external work',()=>{
 it('does not create any session or request Auth before explicit current consent',async()=>{
  expect((await startAnonymous({},form({}))).error).toContain('согласие');expect(s.rpc).not.toHaveBeenCalled();expect(s.request).not.toHaveBeenCalled();
  expect((await startAnonymous({},form({consent:'on',consent_version:'old'}))).error).toContain('обновились');expect(s.rpc).not.toHaveBeenCalled();
 });
 it('rejects cross-origin writes before reading or changing a session',async()=>{
  s.guard.mockRejectedValue(Error('acquisition_origin'));await startAnonymous({},form({consent:'on',consent_version:'current'}));expect(s.context).not.toHaveBeenCalled();expect(s.rpc).not.toHaveBeenCalled();
 });
 it('validates name/email and leaves marketing optional',async()=>{
  expect((await sendAccess({},form({email:'invalid',display_name:'Name',marketing_version:'current'}))).error).toContain('email');expect(s.request).not.toHaveBeenCalled();
  expect(await sendAccess({},form({email:'synthetic@example.test',display_name:'Name',marketing_version:'current'}))).toEqual({sent:true});expect(s.request).toHaveBeenCalledWith('session','hash',expect.objectContaining({marketing_granted:false}));
 });
 it('requires updated data consent before any new access email',async()=>{
  s.session.mockResolvedValue({consent_version:'old'});const result=await sendAccess({},form({email:'synthetic@example.test',display_name:'Name',marketing_version:'current'}));expect(result.error).toContain('согласие');expect(s.request).not.toHaveBeenCalled();
 });
 it('a different signed-in email never consumes the mailed credential',async()=>{
  const verify=vi.fn();s.auth.mockReturnValue({getUser:async()=>({data:{user:{email:'other@example.test',email_confirmed_at:'now'}}}),verifyOtp:verify});expect((await confirmAccess({},new FormData())).error).toContain('другим адресом');expect(verify).not.toHaveBeenCalled();expect(s.claim).not.toHaveBeenCalled();
 });
 it('new verified email uses Supabase verification, then normal claim, without Company chooser',async()=>{
  const verify=vi.fn(async()=>({data:{user:{email:'synthetic@example.test',email_confirmed_at:'now'}},error:null}));s.auth.mockReturnValue({getUser:async()=>({data:{user:null}}),verifyOtp:verify});
  s.claim.mockImplementation(async(_id:string,_hash:string,mode:string)=>mode==='recover'?{status:'claim_pending'}:mode==='choices'?{new_user:true,companies:[],accounts:[]}:{status:'claimed',diagnostic_id:'diagnostic'});
  await expect(confirmAccess({},new FormData())).rejects.toThrow('REDIRECT:/ru/diagnostics/diagnostic/result');expect(verify).toHaveBeenCalledWith({token_hash:'token-hash',type:'magiclink'});expect(s.clear).toHaveBeenCalledTimes(1);
 });
 it('an unresolved Company selection preserves the anonymous authorization cookie',async()=>{
  s.claim.mockResolvedValue({status:'selection_required'});const result=await finishClaim({},new FormData());expect(result.error).toContain('компании');expect(s.clear).not.toHaveBeenCalled();
 });
});
