import {beforeEach,describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
const read=vi.hoisted(()=>vi.fn());
vi.mock('server-only',()=>({}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('@/server/auth/session',()=>({requireIdentity:async()=>({user:{id:'owner'}})}));
vi.mock('@/server/billing/service',()=>({readCheckout:read}));
import Page from '@/app/[locale]/(workspace)/billing/return/page';
const checkout={id:'10000000-0000-4000-8000-000000000001',account_id:'20000000-0000-4000-8000-000000000001',account_name:'Test account',company_id:'30000000-0000-4000-8000-000000000001',company_name:'Original Company',status:'pending',plan:'free',test_mode:true,expires_at:new Date(Date.now()+60000).toISOString()};
beforeEach(()=>{read.mockReset();read.mockResolvedValue(checkout);});
describe('non-authoritative billing return',()=>{
 it('cannot activate using a forged success query',async()=>{read.mockRejectedValue(Error('denied'));const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({success:'true'} as {checkout?:string})}));expect(html).toContain('Оплата не подтверждена');expect(html).not.toContain('Advanced подключён');expect(read).toHaveBeenCalledWith('',true);});
 it('shows local pending state even if the browser returned first',async()=>{const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({checkout:checkout.id})}));expect(html).toContain('Проверяем оплату');expect(html).toContain('прошло 0 сек.');expect(html).not.toContain('Создать командную диагностику');});
 it('requires both paid checkout and committed Advanced, preserving Company',async()=>{read.mockResolvedValue({...checkout,status:'succeeded',plan:'advanced'});const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({checkout:checkout.id})}));expect(html).toContain('Advanced подключён');expect(html).toContain('/ru/companies/'+checkout.company_id+'/diagnostics?new=1&amp;type=team#team-create');expect(html).toContain('Original Company');});
 it('does not claim Advanced after a confirmed subscription end',async()=>{read.mockResolvedValue({...checkout,status:'succeeded',plan:'free'});const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({checkout:checkout.id})}));expect(html).not.toContain('Advanced подключён');expect(html).toContain('Индивидуальная диагностика');});
 it.each(['failed','cancelled','expired'])('keeps report access and safe retry after %s',async status=>{read.mockResolvedValue({...checkout,status});const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({checkout:checkout.id})}));expect(html).toContain('Индивидуальная диагностика');expect(html).toContain('/ru/account/plan?account='+checkout.account_id);expect(html).not.toContain('Создать командную диагностику');});
});
