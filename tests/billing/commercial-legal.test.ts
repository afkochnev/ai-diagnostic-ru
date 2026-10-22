import {createHash} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('@/server/billing/service',()=>({billingRpc:vi.fn()}));
import {billingRpc} from '@/server/billing/service';
import {currentCommercialTerms,publishedCommercialTerms} from '@/server/billing/legal';
import {commercialTermsRpc} from '@/server/billing/legal-contract';
const body='This is synthetic test text, not an approved public offer. '.repeat(5),hash=createHash('sha256').update(body).digest('hex');
const document={version:'advanced-terms-ru-v1',title:'Synthetic',body,content_sha256:hash,approved_at:'2026-10-22T00:00:00Z'};
beforeEach(()=>vi.resetAllMocks());
describe('commercial document availability and version evidence',()=>{
 it('does not substitute generated legal text for a missing document or failed DB read',async()=>{
  vi.mocked(billingRpc).mockResolvedValue(null);expect(await currentCommercialTerms()).toBeNull();
  vi.mocked(billingRpc).mockRejectedValue(Error('offline'));expect(await currentCommercialTerms()).toBeNull();
 });
 it('requires an intact approved current document and serves its exact body',async()=>{
  vi.mocked(billingRpc).mockResolvedValue(document);expect(await currentCommercialTerms()).toEqual(document);
  vi.mocked(billingRpc).mockResolvedValue({...document,body:body+'changed'});expect(await currentCommercialTerms()).toBeNull();
 });
 it('keeps historical version reads separate from current checkout version',async()=>{
  const old={...document,version:'advanced-terms-ru-v2'};vi.mocked(billingRpc).mockResolvedValue(old);
  expect(await currentCommercialTerms()).toBeNull();expect(await publishedCommercialTerms(old.version)).toEqual(old);
  expect(await publishedCommercialTerms(document.version)).toBeNull();
 });
 it('requires explicit acceptance plus the exact version and digest',()=>{
  const input={version:'advanced-terms-ru-v1' as const,sha256:hash,accepted:true as const};
  expect(commercialTermsRpc(input)).toEqual({p_terms_version:input.version,p_terms_sha256:hash,p_terms_accepted:true});
  expect(()=>commercialTermsRpc({...input,accepted:false} as never)).toThrow();
  expect(()=>commercialTermsRpc({...input,version:'temporary-ru-v1'} as never)).toThrow();
 });
});
