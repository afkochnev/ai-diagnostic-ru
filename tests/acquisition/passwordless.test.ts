import {beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({reserve:vi.fn(),sent:vi.fn(),generate:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/server/acquisition/service',()=>({sessionRpc:state.reserve}));
vi.mock('@/server/consultation/provider',()=>({createTransactionalProvider:()=>({send:state.sent})}));
vi.mock('@/server-runtime/supabase/admin',()=>({createAdminClient:()=>({auth:{admin:{generateLink:state.generate}}})}));
vi.mock('@/server/supabase/config',()=>({authConfig:()=>({APP_URL:'https://ai-diagnostic-staging-web.onrender.com',AUTH_FLOW_SECRET:'unit-test-secret-separate-from-runtime-000000000'})}));
vi.mock('next/headers',()=>({cookies:vi.fn(),headers:vi.fn()}));
vi.mock('@/server/rate-limit',()=>({enforceRateLimit:vi.fn()}));
import {requestAccess,accessMessage} from '@/server/acquisition/email';
const input={email:'synthetic@example.test',display_name:'Synthetic',marketing_granted:false,marketing_version:'temporary-ru-v1'};
beforeEach(()=>{vi.clearAllMocks();state.reserve.mockImplementation(async(op:string)=>op==='email'?{reserved:true,create_user:false,generation:1}:{ok:true});state.generate.mockResolvedValue({data:{properties:{verification_type:'magiclink',hashed_token:'a'.repeat(64)},user:{email:input.email}},error:null});state.sent.mockResolvedValue({providerMessageId:'mock'});vi.stubEnv('ACQUISITION_EMAIL_PROVIDER','mock');});
describe('V25 one passwordless access email',()=>{
 it('existing email gets magiclink without password or metadata changes',async()=>{
  await requestAccess('10000000-0000-4000-8000-000000000001','a'.repeat(64),input);
  expect(state.generate).toHaveBeenCalledWith({type:'magiclink',email:input.email,options:{redirectTo:'https://ai-diagnostic-staging-web.onrender.com/ru/free/confirm'}});
  expect(state.sent).toHaveBeenCalledTimes(1);const m=state.sent.mock.calls[0][0];
  const link=m.text.split('\n').find((line:string)=>line.startsWith('https://'));
  expect(link).toContain('/ru/free/confirm#session=');
  // Random authenticated ciphertext may contain "OTP" by chance. Check the
  // displayed instructions separately; the link contract is asserted above.
  expect(m.text.replace(link,'')).not.toMatch(/одноразов|OTP|код:/i);expect(m.idempotencyKey).toContain('/1');
 });
 it('new identity uses a server-reserved nonce and no provisioning/consent metadata shortcut',async()=>{
  state.reserve.mockResolvedValueOnce({reserved:true,create_user:true,generation:1});state.generate.mockResolvedValueOnce({data:{properties:{verification_type:'invite',hashed_token:'b'.repeat(64)},user:{email:input.email}},error:null});
  await requestAccess('10000000-0000-4000-8000-000000000001','a'.repeat(64),input);
  const req=state.generate.mock.calls[0][0];expect(req.type).toBe('invite');expect(Object.keys(req.options.data)).toEqual(['anonymous_pending_nonce']);expect(req.options.data.anonymous_pending_nonce).toMatch(/^[a-f0-9]{64}$/);expect(req.options.data).not.toHaveProperty('role');
 });
 it('atomic cooldown reservation blocks double sends before Auth link generation',async()=>{
  state.reserve.mockResolvedValueOnce({reserved:false});await requestAccess('10000000-0000-4000-8000-000000000001','a'.repeat(64),input);expect(state.generate).not.toHaveBeenCalled();expect(state.sent).not.toHaveBeenCalled();
 });
 it('mismatched Auth identity fails before any provider call',async()=>{
  state.generate.mockResolvedValueOnce({data:{properties:{verification_type:'magiclink',hashed_token:'a'.repeat(64)},user:{email:'other@example.test'}},error:null});await expect(requestAccess('10000000-0000-4000-8000-000000000001','a'.repeat(64),input)).rejects.toThrow('email_unavailable');expect(state.sent).not.toHaveBeenCalled();
 });
 it('message contains one access action, no numeric code or report-ready claim',()=>{
  const url='https://example.test/confirm#access=opaque-OTP-code';
  const m=accessMessage(url);expect(m.html.match(/<a /g)).toHaveLength(1);expect(m.text).toContain(url);expect(m.text).toContain('30 минут');
  const prose=m.text.replace(url,'');expect(prose).not.toContain('отчёт готов');expect(prose).not.toMatch(/одноразов|OTP|код/i);
 });
});
