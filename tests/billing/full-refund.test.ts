import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('@/server/billing/service',()=>({billingRpc:vi.fn()}));
import {YooKassaBillingProvider,type YooKassaContext,yookassaVerificationConfigured,yookassaConfigured} from '@/server/billing/yookassa';
import {processYooKassaWebhook,reconcileFullRefund,createFullYooKassaRefund,type YooKassaDependencies} from '@/server/billing/yookassa-service';
const id='28000000-0000-4000-8000-000000000001',aid='28000000-0000-4000-8000-000000000002',oid='28000000-0000-4000-8000-000000000003',pid='28000000-0000-5000-9000-000000000004',rid='28000000-0000-5000-9000-000000000005';
const now=new Date().toISOString(),created=new Date(Date.now()-60000).toISOString();
const env={NODE_ENV:'test',BILLING_ENABLED:'true',BILLING_PROVIDER:'yookassa',APP_URL:'http://127.0.0.1:3000',SUPABASE_URL:'http://127.0.0.1:54321',YOOKASSA_TEST_MODE:'true',YOOKASSA_SHOP_ID:'123456',YOOKASSA_SECRET_KEY:'test_synthetic',YOOKASSA_RECEIPT_CONFIG_CONFIRMED:'true',YOOKASSA_PAYMENT_MODE_CONFIRMED:'true',YOOKASSA_PAYMENT_MODE:'full_payment',YOOKASSA_RECEIPT_SOLUTION:'external',YOOKASSA_RECEIPT_REQUIRES_TAX_SYSTEM_CODE:'false',YOOKASSA_REFUNDS_ENABLED:'true',YOOKASSA_REFUND_RECEIPT_MODE:'from_original_payment'};
const c:YooKassaContext={id,account_id:aid,company_id:null,offer_id:oid,offer_key:'yookassa-advanced-annual-480-rub',amount_minor:48000,currency:'RUB',merchant_ref:'123456',provider_test_mode:true,provider_payment_ref:pid,created_at:created,status:'succeeded'};
const payment=(patch={})=>({id:pid,status:'succeeded',paid:true,test:true,amount:{value:'480.00',currency:'RUB'},recipient:{account_id:'123456'},metadata:{checkout_id:id,account_id:aid,offer_id:oid},created_at:created,captured_at:created,receipt_registration:'succeeded',refunded_amount:{value:'480.00',currency:'RUB'},...patch});
const refund=(patch={})=>({id:rid,payment_id:pid,status:'succeeded',amount:{value:'480.00',currency:'RUB'},created_at:now,receipt_registration:'succeeded',...patch});
let transport=vi.fn();
beforeEach(()=>{transport=vi.fn(async(url:string)=>Response.json(url.includes('/refunds/')?refund():payment()));});
function provider(e=env){return new YooKassaBillingProvider(e,transport,'verification');}
function deps(){const rpc=vi.fn(async(name:string)=>name==='billing_yookassa_payment_context'?c:{status:'processed',duplicate:false});return {rpc,provider} as unknown as YooKassaDependencies;}
describe('verified full refunds, fake HTTP only',()=>{
 it('verifies refund ID and original payment GET before recording a full refund',async()=>{
  const d=deps();await reconcileFullRefund(rid,d);
  expect(transport.mock.calls.map(x=>x[0])).toEqual(['https://api.yookassa.ru/v3/refunds/'+rid,'https://api.yookassa.ru/v3/payments/'+pid]);
  expect(d.rpc).toHaveBeenCalledWith('billing_record_verified_refund',expect.objectContaining({p_checkout_id:id,p_refund_ref:rid,p_amount_minor:48000,p_currency:'RUB',p_status:'succeeded'}),true);
 });
 it.each([{id:pid},{payment_id:id},{amount:{value:'479.00',currency:'RUB'}},{amount:{value:'480.00',currency:'USD'}},{created_at:'2099-01-01T00:00:00Z'}])('rejects mismatched/partial refund %# before any downgrade',async patch=>{
  transport.mockResolvedValue(Response.json(refund(patch)));const d=deps();await expect(reconcileFullRefund(rid,d)).rejects.toThrow();
  expect(d.rpc).not.toHaveBeenCalledWith('billing_record_verified_refund',expect.anything(),true);
 });
 it.each([{test:false},{recipient:{account_id:'999'}},{metadata:{checkout_id:id,account_id:id,offer_id:oid}},{refunded_amount:{value:'0.00',currency:'RUB'}},{paid:false},{status:'pending'},{captured_at:'2099-01-01T00:00:00Z'}])('rejects unconfirmed original payment %#',async patch=>{
  transport.mockImplementation(async(url:string)=>Response.json(url.includes('/refunds/')?refund():payment(patch)));const d=deps();
  await expect(reconcileFullRefund(rid,d)).rejects.toThrow();expect(d.rpc).not.toHaveBeenCalledWith('billing_record_verified_refund',expect.anything(),true);
 });
 it('does not trust a forged notification amount or its payment ID',async()=>{
  const d=deps();await processYooKassaWebhook(JSON.stringify({type:'notification',event:'refund.succeeded',object:{id:rid,payment_id:aid,status:'succeeded',amount:{value:'999.00'}}}),d);
  expect(d.rpc).toHaveBeenCalledWith('billing_yookassa_payment_context',{p_payment_ref:pid},true);
 });
 it('stops for an unbound payment and never records any refund',async()=>{
  const d=deps();vi.mocked(d.rpc).mockResolvedValue(null);await expect(reconcileFullRefund(rid,d)).rejects.toThrow('not_bound');expect(transport).toHaveBeenCalledTimes(1);
 });
 it.each(['pending','canceled'])('records %s without falsely promoting it to success',async status=>{
  transport.mockImplementation(async(url:string)=>Response.json(url.includes('/refunds/')?refund({status}):payment({refunded_amount:{value:'0.00',currency:'RUB'}})));
  const d=deps();await reconcileFullRefund(rid,d);expect(d.rpc).toHaveBeenCalledWith('billing_record_verified_refund',expect.objectContaining({p_status:status}),true);
 });
 it('requests redelivery when a succeeded notification still GETs pending',async()=>{
  transport.mockImplementation(async(url:string)=>Response.json(url.includes('/refunds/')?refund({status:'pending'}):payment()));const d=deps();
  vi.mocked(d.rpc).mockImplementation(async name=>name==='billing_yookassa_payment_context'?c:{status:'pending',duplicate:false});
  await expect(processYooKassaWebhook(JSON.stringify({type:'notification',event:'refund.succeeded',object:{id:rid}}),d)).rejects.toMatchObject({retryable:true});
 });
 it('billing OFF denies creation but still permits authenticated reconciliation; explicit reconciliation OFF stops it',async()=>{
  const off={...env,BILLING_ENABLED:'false'};expect(yookassaConfigured(off)).toBe(false);expect(yookassaVerificationConfigured(off)).toBe(true);
  await provider(off).retrieveRefund(rid);expect(()=>provider(off).assertCheckoutReady()).toThrow('unavailable');
  expect(yookassaVerificationConfigured({...off,YOOKASSA_RECONCILIATION_ENABLED:'false'})).toBe(false);
 });
 it('cannot use production credentials/origin for either refund or reconciliation',()=>{
  expect(yookassaVerificationConfigured({...env,NODE_ENV:'production',APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co'})).toBe(false);
  expect(yookassaVerificationConfigured({...env,YOOKASSA_SECRET_KEY:'live_synthetic'})).toBe(false);
 });
 it('uses the persisted key and fixed full amount for POST; never issues a second POST on transport failure',async()=>{
  transport.mockImplementation(async(url:string,init:RequestInit)=>{
   if(init.method==='POST')throw Error('private transport error');return Response.json(payment({refunded_amount:{value:'0.00',currency:'RUB'}}));
  });
  const r={id,created_at:now,provider_refund_ref:null,status:'requested'};
  await expect(provider().createFullRefund(r,c)).rejects.toMatchObject({retryable:true});
  const post=transport.mock.calls.filter(x=>x[1].method==='POST');expect(post).toHaveLength(1);
  expect(post[0][1].headers).toMatchObject({'Idempotence-Key':id});expect(JSON.parse(post[0][1].body)).toEqual({payment_id:pid,amount:{value:'480.00',currency:'RUB'}});
 });
 it.each([{YOOKASSA_REFUNDS_ENABLED:'false'},{YOOKASSA_REFUND_RECEIPT_MODE:''}])('does not POST until explicit refund and receipt gates are ready %#',async patch=>{
  await expect(provider({...env,...patch}).createFullRefund({id,created_at:now,provider_refund_ref:null,status:'requested'},c)).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
 });
 it('never reissues an ambiguous refund outside its persisted idempotency window',async()=>{
  await expect(provider().createFullRefund({id,created_at:new Date(Date.now()-24*3600000).toISOString(),provider_refund_ref:null,status:'requested'},c)).rejects.toThrow('reconciliation_required');expect(transport).not.toHaveBeenCalled();
 });
 it('persists the POST reference before an uncertain GET so later checks never need a fresh refund',async()=>{
  const p={createFullRefund:vi.fn(async()=>refund()),retrieveRefund:vi.fn(async()=>{throw Error('GET temporarily unavailable');})};
  const rpc=vi.fn(async(name:string)=>name==='billing_request_full_refund'?{id,checkout_id:id,created_at:now,provider_refund_ref:null,status:'requested'}:c);
  await expect(createFullYooKassaRefund(id,{rpc,provider:()=>p} as unknown as YooKassaDependencies)).rejects.toThrow('temporarily unavailable');
  expect(rpc).toHaveBeenCalledWith('billing_bind_full_refund',{p_request_id:id,p_checkout_id:id,p_refund_ref:rid},true);expect(p.createFullRefund).toHaveBeenCalledTimes(1);
 });
});
