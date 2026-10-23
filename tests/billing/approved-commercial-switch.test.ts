import{describe,it,expect,vi}from'vitest';
vi.mock('server-only',()=>({}));
import{annualOffer}from'@/server/billing/commercial';
import{billingConfig}from'@/server/billing/contracts';
import{YooKassaBillingProvider,yookassaConfigured}from'@/server/billing/yookassa';
const env={NODE_ENV:'production',APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co',BILLING_PROVIDER:'yookassa',BILLING_ENABLED:'false',YOOKASSA_TEST_MODE:'false',YOOKASSA_PRODUCTION_CONFIRMED:'true',YOOKASSA_SHOP_ID:'1079713',YOOKASSA_SECRET_KEY:'live_synthetic_not_a_credential'};
describe('approved commercial source switch with independent runtime gates',()=>{
 it('does not open checkout with the runtime creation gate closed',()=>{
  expect(annualOffer.productionEnabled).toBe(true);
  expect(yookassaConfigured(env)).toBe(false);expect(billingConfig(env).enabled).toBe(false);
  const http=vi.fn();expect(()=>new YooKassaBillingProvider(env,http)).toThrow('billing_unavailable');expect(http).not.toHaveBeenCalled();
 });
 it('does not open checkout without a live credential even if creation is requested',()=>{
  const e={...env,BILLING_ENABLED:'true',YOOKASSA_SECRET_KEY:undefined};const http=vi.fn();
  expect(yookassaConfigured(e)).toBe(false);expect(billingConfig(e).enabled).toBe(false);
  expect(()=>new YooKassaBillingProvider(e,http)).toThrow('billing_unavailable');expect(http).not.toHaveBeenCalled();
 });
});
