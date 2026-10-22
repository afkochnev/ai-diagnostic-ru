import {describe,it,expect,vi,beforeEach} from 'vitest';
import {consentLinks} from '@/server/auth/legal-contract';
import {buildSignupMetadata} from '@/server/auth/registration-contract';
const s=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/server/supabase/admin',()=>({createAdminClient:()=>({rpc:s.rpc})}));
import {sendPermittedMarketing} from '@/server/email/marketing';
const pointers=[{kind:'data_processing',version:'data-processing-consent-ru-v1',is_temporary:false},{kind:'marketing',version:'marketing-consent-ru-v1',is_temporary:false}];
const documents=[{version:'data-processing-policy-ru-v1',kind:'policy',policy_version:null},...pointers.map(p=>({version:p.version,kind:p.kind,policy_version:'data-processing-policy-ru-v1'}))];
beforeEach(()=>vi.clearAllMocks());
describe('Exact privacy versions and operational withdrawal',()=>{
 it('binds exact consent and policy versions independent of mutable environment URLs',()=>{
  expect(consentLinks(pointers,documents)).toEqual({versions:{data_processing:pointers[0].version,marketing:pointers[1].version},temporary:false,dataUrl:'/ru/legal/privacy/data-processing-consent-ru-v1',marketingUrl:'/ru/legal/privacy/marketing-consent-ru-v1',policyUrl:'/ru/legal/privacy/data-processing-policy-ru-v1'});
 });
 it('fails closed on an unpublished document or policy reference',()=>{
  expect(()=>consentLinks(pointers,[])).toThrow();expect(()=>consentLinks(pointers,documents.slice(1))).toThrow();expect(()=>consentLinks([pointers[0],pointers[0]],documents)).toThrow();
 });
 it('leaves temporary versions available until the explicitly approved switch',()=>{
  expect(consentLinks(pointers.map(p=>({...p,version:'temporary-ru-v1',is_temporary:true})),[])).toMatchObject({temporary:true,dataUrl:'/ru/legal/data-processing',marketingUrl:'/ru/legal/marketing'});
 });
 it('registers optional marketing false with exact final versions',()=>{
  const links=consentLinks(pointers,documents);
  expect(buildSignupMetadata({full_name:'Synthetic',data_processing_consent:true,marketing_consent:false,versions:Object.fromEntries(Object.entries(links.versions).map(([k,v])=>[`${k}_version`,v]))})).toMatchObject({marketing_consent:false,data_processing_version:pointers[0].version,marketing_version:pointers[1].version});
 });
 it.each([false,null,undefined])('denies future marketing sends for eligibility %s',async(data)=>{
  s.rpc.mockResolvedValue({data,error:null});const send=vi.fn();await expect(sendPermittedMarketing('user',send)).rejects.toThrow('marketing_not_allowed');expect(send).not.toHaveBeenCalled();
 });
 it('fails closed when current eligibility cannot be read',async()=>{
  s.rpc.mockResolvedValue({data:true,error:Error()});const send=vi.fn();await expect(sendPermittedMarketing('user',send)).rejects.toThrow();expect(send).not.toHaveBeenCalled();
 });
 it('checks permission immediately before a future marketing send',async()=>{
  s.rpc.mockResolvedValue({data:true,error:null});const send=vi.fn(async()=> 'sent');expect(await sendPermittedMarketing('user',send)).toBe('sent');expect(s.rpc).toHaveBeenCalledWith('marketing_send_allowed',{p_user_id:'user'});
 });
});
