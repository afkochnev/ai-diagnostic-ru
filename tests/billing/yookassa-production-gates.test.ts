import{describe,it,expect,vi}from'vitest';
vi.mock('server-only',()=>({}));
import{annualOffer,yookassaRuntimeMode}from'@/server/billing/commercial';
import{billingConfig}from'@/server/billing/contracts';
import{YooKassaBillingProvider,yookassaConfigured,yookassaVerificationConfigured}from'@/server/billing/yookassa';
const env={NODE_ENV:'production',APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co',BILLING_PROVIDER:'yookassa',BILLING_ENABLED:'true',YOOKASSA_TEST_MODE:'false',YOOKASSA_PRODUCTION_CONFIRMED:'true',YOOKASSA_SHOP_ID:'654321',YOOKASSA_SECRET_KEY:'live_synthetic_not_a_credential'};
describe('production capability does not enable production billing',()=>{
 it('retains the authoritative OFF switch even with otherwise valid live inputs',()=>{expect(annualOffer.productionEnabled).toBe(false);expect(yookassaRuntimeMode(env)).toBe('production');expect(yookassaConfigured(env)).toBe(false);expect(billingConfig(env).enabled).toBe(false);const http=vi.fn();expect(()=>new YooKassaBillingProvider(env,http)).toThrow('billing_unavailable');expect(http).not.toHaveBeenCalled();});
 it('can reconcile bound payments independently from new payment creation',()=>{expect(yookassaVerificationConfigured({...env,BILLING_ENABLED:'false'})).toBe(true);expect(yookassaVerificationConfigured({...env,YOOKASSA_RECONCILIATION_ENABLED:'false'})).toBe(false);});
 it.each([{APP_URL:'https://ai-diagnostic-staging-web.onrender.com',SUPABASE_URL:'https://vflgxgdwlftlyjslyrmo.supabase.co'},{APP_URL:'https://audit.iteam.ru.evil'},{SUPABASE_URL:'https://vflgxgdwlftlyjslyrmo.supabase.co'},{NODE_ENV:'test'},{YOOKASSA_TEST_MODE:'true'},{YOOKASSA_TEST_MODE:undefined},{YOOKASSA_PRODUCTION_CONFIRMED:undefined},{YOOKASSA_SECRET_KEY:'test_synthetic'},{YOOKASSA_SHOP_ID:'invalid'}])('rejects wrong deployment, mode, credentials or missing confirmation %#',patch=>{const e={...env,...patch};expect(yookassaRuntimeMode(e)).toBeNull();expect(yookassaVerificationConfigured(e)).toBe(false);expect(()=>new YooKassaBillingProvider(e,vi.fn(),'verification')).toThrow('billing_unavailable');});
 it('cannot enable a production mock checkout',()=>expect(billingConfig({...env,BILLING_PROVIDER:'mock'}).enabled).toBe(false));
});
