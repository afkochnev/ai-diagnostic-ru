import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
const read=vi.hoisted(()=>vi.fn());
const reconcile=vi.hoisted(()=>vi.fn());
vi.mock('@/server/billing/yookassa-service',()=>({reconcileYooKassaCheckout:reconcile}));
vi.mock('@/server/rate-limit',()=>({enforceRateLimit:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()}),notFound:()=>{throw Error('not_found');}}));
vi.mock('@/server/auth/session',()=>({requireIdentity:async()=>({user:{id:'owner'}})}));
vi.mock('@/server/billing/service',()=>({readCheckout:read}));
import Page from '@/app/[locale]/(workspace)/billing/return/page';
import MockPage from '@/app/[locale]/(workspace)/billing/mock/[checkoutId]/page';
const checkout={id:'10000000-0000-4000-8000-000000000001',account_id:'20000000-0000-4000-8000-000000000001',account_name:'Test account',company_id:'30000000-0000-4000-8000-000000000001',company_name:'Original Company',status:'pending',plan:'free',test_mode:true,expires_at:new Date(Date.now()+60000).toISOString()};
beforeEach(()=>{read.mockReset();read.mockResolvedValue(checkout);reconcile.mockReset();reconcile.mockResolvedValue({status:'processed'});});
afterEach(()=>vi.unstubAllEnvs());
describe('non-authoritative billing return',()=>{
 it('rechecks YooKassa server-to-server then rereads committed state and keeps Company',async()=>{read.mockResolvedValueOnce({...checkout,provider_key:'yookassa'}).mockResolvedValueOnce({...checkout,provider_key:'yookassa',status:'succeeded',plan:'advanced',effective_until:'2027-10-21T10:00:00Z'});const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({checkout:checkout.id})}));expect(reconcile).toHaveBeenCalledWith(checkout.id);expect(html).toContain('Advanced подключён');expect(html).toContain(checkout.company_id);expect(html).toContain('21.10.2027');});
 it('shows a real-mode paid result without a test label',async()=>{read.mockResolvedValue({...checkout,provider_key:'yookassa',test_mode:false,status:'succeeded',plan:'advanced'});const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({checkout:checkout.id})}));expect(html).toContain('Advanced подключён');expect(html).not.toContain('Тестовый режим оплаты');expect(html).not.toContain('реальные деньги не списываются');});
 it('keeps pending without activation when server verification fails',async()=>{read.mockResolvedValue({...checkout,provider_key:'yookassa'});reconcile.mockRejectedValue(Error('unavailable'));const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({checkout:checkout.id})}));expect(html).toContain('Проверяем оплату');expect(html).toContain('Проверить оплату');expect(html).not.toContain('Advanced подключён');expect(html).toContain('повторно платить не нужно');});

 it('cannot activate using a forged success query',async()=>{read.mockRejectedValue(Error('denied'));const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({success:'true'} as {checkout?:string})}));expect(html).toContain('Оплата не подтверждена');expect(html).not.toContain('Advanced подключён');expect(read).toHaveBeenCalledWith('',true);});
 it('shows local pending state even if the browser returned first',async()=>{const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({checkout:checkout.id})}));expect(html).toContain('Проверяем оплату');expect(html).toContain('прошло 0 сек.');expect(html).not.toContain('Создать командную диагностику');});
 it('requires both paid checkout and committed Advanced, preserving Company',async()=>{read.mockResolvedValue({...checkout,status:'succeeded',plan:'advanced'});const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({checkout:checkout.id})}));expect(html).toContain('Advanced подключён');expect(html).toContain('/ru/companies/'+checkout.company_id+'/diagnostics?new=1&amp;type=team#team-create');expect(html).toContain('Original Company');});
 it('does not claim Advanced after a confirmed subscription end',async()=>{read.mockResolvedValue({...checkout,status:'succeeded',plan:'free'});const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({checkout:checkout.id})}));expect(html).not.toContain('Advanced подключён');expect(html).toContain('Индивидуальная диагностика');});
 it.each(['failed','cancelled','expired'])('keeps report access and safe retry after %s',async status=>{read.mockResolvedValue({...checkout,status});const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({checkout:checkout.id})}));expect(html).toContain('Индивидуальная диагностика');expect(html).toContain('/ru/account/plan?account='+checkout.account_id);expect(html).not.toContain('Создать командную диагностику');});
});

describe('test checkout isolation',()=>{
 function readyMock(){for(const[k,v]of Object.entries({APP_URL:'https://ai-diagnostic-staging-web.onrender.com',SUPABASE_URL:'https://vflgxgdwlftlyjslyrmo.supabase.co',BILLING_PROVIDER:'mock',BILLING_ENABLED:'true'}))vi.stubEnv(k,v);}
 it('never opens the mock payment screen for a YooKassa deployment',async()=>{
  readyMock();vi.stubEnv('BILLING_PROVIDER','yookassa');
  await expect(MockPage({params:Promise.resolve({checkoutId:checkout.id})})).rejects.toThrow('not_found');
  expect(read).not.toHaveBeenCalled();
 });
 it.each([{provider_key:'yookassa',test_mode:true},{provider_key:'mock',test_mode:false}])('never labels a non-mock or real checkout as simulated %#',async patch=>{
  readyMock();read.mockResolvedValue({...checkout,...patch});
  await expect(MockPage({params:Promise.resolve({checkoutId:checkout.id})})).rejects.toThrow('not_found');
 });
 it('keeps the simulated screen available for a genuine mock test checkout',async()=>{
  readyMock();read.mockResolvedValue({...checkout,provider_key:'mock'});
  const html=renderToStaticMarkup(await MockPage({params:Promise.resolve({checkoutId:checkout.id})}));
  expect(html).toContain('Тестовая оплата Advanced');expect(html).toContain('Симулировать успешную оплату');
 });
});
