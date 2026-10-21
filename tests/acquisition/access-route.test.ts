import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const state=vi.hoisted(()=>({claim:vi.fn(),proof:vi.fn(),set:vi.fn(),origin:vi.fn()}));
vi.mock('@/server/acquisition/context',()=>({guardOrigin:state.origin,cookieContext:vi.fn(),setContext:vi.fn(),newSecret:vi.fn(),hash:vi.fn(),ipLimit:vi.fn(),limit:vi.fn(),visitCookie:'journey'}));
vi.mock('@/server/acquisition/service',()=>({claimRpc:state.claim,sessionRpc:vi.fn(),trackInteraction:vi.fn()}));
vi.mock('@/server/acquisition/email',()=>({accessProof:state.proof}));
vi.mock('@/server/auth/session',()=>({getIdentity:vi.fn()}));
vi.mock('@/server/supabase/config',()=>({authConfig:()=>({secure:true})}));
vi.mock('next/headers',()=>({cookies:async()=>({set:state.set})}));
import {POST} from '@/app/api/acquisition/[operation]/route';
const id='10000000-0000-4000-8000-000000000001',did='10000000-0000-4000-8000-000000000002';
const req=()=>new Request('https://test/api/acquisition/access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,envelope:'sealed-synthetic-proof'})});
const params={params:Promise.resolve({operation:'access'})};
beforeEach(()=>{vi.clearAllMocks();state.origin.mockResolvedValue(undefined);state.claim.mockRejectedValue(Error('not_owned'));state.proof.mockReturnValue(null);});
it('uses the verified DB owner receipt as a bookmark even after the access envelope expires',async()=>{
 state.claim.mockResolvedValue({status:'claimed',diagnostic_id:did});const r=await POST(req(),params);
 expect(await r.json()).toEqual({ok:true,diagnosticId:did});expect(state.claim).toHaveBeenCalledWith(id,null,'receipt');expect(state.proof).not.toHaveBeenCalled();expect(state.set).not.toHaveBeenCalled();
});
it('denies an expired proof to anybody without that owned receipt',async()=>{
 const r=await POST(req(),params);expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'expired'});expect(state.set).not.toHaveBeenCalled();
});
it('captures a live sealed proof only in secure HttpOnly cookies and returns no credential',async()=>{
 state.proof.mockReturnValue({email:'synthetic@example.test'});const r=await POST(req(),params);
 expect(await r.json()).toEqual({ok:true});expect(state.set).toHaveBeenCalledWith('aca-access','sealed-synthetic-proof',{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:1800});
});
it('rejects a foreign origin before reading any owned receipt',async()=>{
 state.origin.mockRejectedValue(Error('acquisition_origin'));expect((await POST(req(),params)).status).toBe(400);expect(state.claim).not.toHaveBeenCalled();expect(state.set).not.toHaveBeenCalled();
});
