import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({enabled:true,process:vi.fn(),create:vi.fn(),limit:vi.fn(),identity:vi.fn(),owner:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/server/billing/yookassa',()=>({yookassaConfigured:()=>state.enabled,yookassaVerificationConfigured:()=>state.enabled,YooKassaError:class extends Error{constructor(readonly code:string,readonly retryable=false){super(code);}}}));
vi.mock('@/server/billing/yookassa-service',()=>({processYooKassaWebhook:state.process,createYooKassaPayment:state.create}));
vi.mock('@/server/rate-limit',()=>({enforceRateLimit:state.limit}));
vi.mock('@/server/auth/session',()=>({requireIdentity:state.identity}));
vi.mock('@/server/account/authorization',()=>({requireAccountWrite:state.owner}));
vi.mock('@/server/supabase/config',()=>({authConfig:()=>({APP_URL:'https://staging.example.test'})}));
import {POST as webhook} from '@/app/api/billing/webhook/yookassa/route';
import {POST as create} from '@/app/api/billing/create-payment/route';
import {YooKassaError} from '@/server/billing/yookassa';
const terms={version:'advanced-terms-ru-v1',sha256:'a'.repeat(64),accepted:true};
const aid='27000000-0000-4000-8000-000000000001';
function req(body:unknown,origin='https://staging.example.test'){return new Request('https://staging.example.test/api/billing/create-payment',{method:'POST',headers:{origin},body:JSON.stringify(typeof body==='object'&&body!==null?{terms,...body}:body)});}
beforeEach(()=>{vi.resetAllMocks();state.enabled=true;state.identity.mockResolvedValue({user:{id:'owner',email:'verified-owner@example.test'}});state.process.mockResolvedValue({status:'processed'});state.create.mockResolvedValue('https://yoomoney.ru/pay');});
describe('bounded YooKassa HTTP endpoints',()=>{
 it.each([null,{...terms,accepted:false},{...terms,version:'temporary-ru-v1'},{...terms,sha256:'invalid'}])('rejects missing or invalid commercial acceptance %# before any payment work',async input=>{
  expect((await create(req({account:aid,terms:input}))).status).toBe(400);expect(state.create).not.toHaveBeenCalled();
 });
 it('returns unavailable before auth/provider work when disabled',async()=>{state.enabled=false;expect((await webhook(req({}))).status).toBe(404);expect((await create(req({account:aid}))).status).toBe(404);expect(state.identity).not.toHaveBeenCalled();expect(state.process).not.toHaveBeenCalled();});
 it('rejects forged CSRF origin before checkout creation',async()=>{expect((await create(req({account:aid},'https://evil.test'))).status).toBe(403);expect(state.create).not.toHaveBeenCalled();});
 it('requires the fresh authenticated owner and takes email from that identity',async()=>{expect((await create(req({account:aid,company:null}))).status).toBe(200);expect(state.owner).toHaveBeenCalledWith(aid,'owner');expect(state.create).toHaveBeenCalledWith(aid,null,'verified-owner@example.test',terms);});
 it.each([{account:aid,amount_minor:1},{account:aid,return_url:'https://evil.test'},{account:aid,email:'attacker@example.test'},{account:aid,offer_id:'invented'}])('rejects client-controlled commercial data %#',async body=>{expect((await create(req(body))).status).toBe(400);expect(state.create).not.toHaveBeenCalled();});
 it('marks an uncertain create timeout retryable without starting a second payment',async()=>{state.create.mockRejectedValue(new YooKassaError('billing_provider_unavailable',true));expect((await create(req({account:aid}))).status).toBe(503);expect(state.create).toHaveBeenCalledTimes(1);});
 it('denies foreign Account checkout before any provider call',async()=>{state.owner.mockRejectedValue(Error('denied'));expect((await create(req({account:aid}))).status).toBe(400);expect(state.create).not.toHaveBeenCalled();});
 it('propagates sign-in redirect rather than treating an anonymous caller as owner',async()=>{state.identity.mockRejectedValue(Error('redirect:login'));await expect(create(req({account:aid}))).rejects.toThrow('redirect:login');});
 it('caps chunked notification bodies before parsing or financial work',async()=>{const r=await webhook(new Request('https://staging.example.test',{method:'POST',body:'x'.repeat(16385)}));expect(r.status).toBe(413);expect(state.process).not.toHaveBeenCalled();});
 it('requires durable verified processing before returning receipt acknowledgement',async()=>{expect((await webhook(req({event:'payment.succeeded'}))).status).toBe(200);expect(state.process).toHaveBeenCalledTimes(1);});
 it.each([['retryable',503],['rejected',422],['ignored',200],['pending',200]])('maps %s safely to HTTP',async(status,code)=>{state.process.mockResolvedValue({status});expect((await webhook(req({}))).status).toBe(code);});
 it('returns retryable HTTP when verification GET is unavailable and leaks no error detail',async()=>{state.process.mockRejectedValue(new YooKassaError('private-detail',true));const r=await webhook(req({}));expect(r.status).toBe(503);expect(await r.text()).not.toContain('private-detail');});
 it('fails closed on rate limiter outage without provider work',async()=>{state.limit.mockRejectedValue(Error('unavailable'));expect((await webhook(req({}))).status).toBe(503);expect(state.process).not.toHaveBeenCalled();});
});
