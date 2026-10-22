import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({admin:vi.fn(),origin:'https://staging.example.test',refund:vi.fn(),limit:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({headers:async()=>new Headers({origin:state.origin})}));
vi.mock('next/navigation',()=>({redirect:(s:string)=>{throw Error('redirect:'+s);}}));
vi.mock('@/server/auth/admin',()=>({requireAdmin:state.admin}));
vi.mock('@/server/supabase/config',()=>({authConfig:()=>({APP_URL:'https://staging.example.test'})}));
vi.mock('@/server/billing/yookassa',()=>({yookassaVerificationConfigured:()=>true}));
vi.mock('@/server/billing/yookassa-service',()=>({createFullYooKassaRefund:state.refund}));
vi.mock('@/server/rate-limit',()=>({enforceRateLimit:state.limit}));
import {requestFullRefund} from '@/server/billing/refund-actions';
const id='28000000-0000-4000-8000-000000000001';
function input(){const f=new FormData();f.set('checkout',id);f.set('amount','480');f.set('refund_requested','on');return f;}
beforeEach(()=>{vi.resetAllMocks();state.origin='https://staging.example.test';state.admin.mockResolvedValue({user:{id:'admin'}});vi.stubEnv('YOOKASSA_REFUNDS_ENABLED','true');});
afterEach(()=>vi.unstubAllEnvs());
describe('refund initiation boundary',()=>{
 it('requires a live administrator before any financial/provider work',async()=>{state.admin.mockRejectedValue(Error('denied'));await expect(requestFullRefund(input())).rejects.toThrow('denied');expect(state.refund).not.toHaveBeenCalled();});
 it('requires same origin and explicit enablement; default OFF cannot request a refund',async()=>{
  vi.stubEnv('YOOKASSA_REFUNDS_ENABLED','false');await expect(requestFullRefund(input())).rejects.toThrow('disabled');expect(state.refund).not.toHaveBeenCalled();
  vi.stubEnv('YOOKASSA_REFUNDS_ENABLED','true');state.origin='https://evil.test';await expect(requestFullRefund(input())).rejects.toThrow('disabled');expect(state.refund).not.toHaveBeenCalled();
 });
 it('requires the recorded user request and a full 480 RUB confirmation',async()=>{const f=input();f.delete('refund_requested');await expect(requestFullRefund(f)).rejects.toThrow('confirmation_required');f.set('refund_requested','on');f.set('amount','479');await expect(requestFullRefund(f)).rejects.toThrow('confirmation_required');expect(state.refund).not.toHaveBeenCalled();});
 it('never retries an uncertain refund or leaks a provider exception',async()=>{state.refund.mockRejectedValue(Error('private provider response'));await expect(requestFullRefund(input())).rejects.toThrow('redirect:/ru/admin/billing?refund=verification_required');expect(state.refund).toHaveBeenCalledTimes(1);});
});
