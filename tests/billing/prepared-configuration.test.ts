import{describe,it,expect,vi}from'vitest';
// Exercise the historical commercial-OFF contract independently of the proposed active source switch.
vi.mock('@/server/billing/commercial',async original=>{const m=await original<typeof import('@/server/billing/commercial')>();return {...m,annualOffer:{...m.annualOffer,productionEnabled:false}};});
import prepared from '../../docs/v27-production-configuration.json';
import{preparedProductionConfigurationReadiness}from'@/server/billing/prepared-configuration';
import{productionBillingReadiness}from'@/server/billing/readiness';

describe('owner-confirmed prepared configuration without installation or a live key',()=>{
 it('reports configuration readiness independently from disabled, uninstalled runtime',()=>{
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('network forbidden'));
  try{
   const report=preparedProductionConfigurationReadiness(prepared);
   expect(report).toMatchObject({status:'V27_PRODUCTION_CONFIGURATION_READY',configurationConfirmedByOwner:true,preparedOnly:true,productionInstalled:false,productionBillingEnabled:false,externalCalls:0});
   const slots:Record<string,string|undefined>={NODE_ENV:'production',APP_URL:prepared.productionOrigin,SUPABASE_URL:prepared.supabaseOrigin};
   for(const[k,v]of Object.entries(prepared.paymentSlots))if(typeof v==='string')slots[k]=v;
   expect(productionBillingReadiness(slots)).toMatchObject({creationSwitchOn:false,fiscalConfirmed:true,remoteMerchantVerificationPerformed:false,productionDatabaseActivationVerified:false});
   expect(productionBillingReadiness(slots).blockers).toContain('PRODUCTION_MERCHANT_CONFIGURATION_UNCONFIRMED');
   expect(network).not.toHaveBeenCalled();
  }finally{network.mockRestore();}
 });
 it.each([
  {YOOKASSA_SHOP_ID:null},{YOOKASSA_SHOP_ID:'1504416'},{YOOKASSA_RECEIPT_SOLUTION:'external'},
  {YOOKASSA_PRODUCTION_CONFIRMED:'false'},{YOOKASSA_PRODUCTION_FISCAL_CONFIRMED:'false'},
  {YOOKASSA_RECEIPT_MEASURE:'other'},{YOOKASSA_RECEIPT_REQUIRES_TAX_SYSTEM_CODE:'true'},
  {YOOKASSA_TAX_SYSTEM_CODE:'2'},{BILLING_ENABLED:'true'},{YOOKASSA_RECONCILIATION_ENABLED:'true'},
  {YOOKASSA_REFUNDS_ENABLED:'true'},{YOOKASSA_SECRET_KEY:'sensitive-value-do-not-echo'}
 ])('cannot accept missing/mismatched identity, invalid fiscal values, secrets or activation flags %#',patch=>{
  const r=preparedProductionConfigurationReadiness({...prepared,paymentSlots:{...prepared.paymentSlots,...patch}});
  expect(r.status).toBe('V27_PRODUCTION_CONFIGURATION_INCOMPLETE');expect(JSON.stringify(r)).not.toContain('sensitive-value');
 });
 it('does not accept a test merchant as production even if both production identity fields are changed together',()=>{
  const c=structuredClone(prepared);c.paymentSlots.YOOKASSA_SHOP_ID=c.stagingTestMerchantConfirmation.shopId;c.merchantConfirmation.productionShopId=c.stagingTestMerchantConfirmation.shopId;
  expect(preparedProductionConfigurationReadiness(c).status).toBe('V27_PRODUCTION_CONFIGURATION_INCOMPLETE');
 });
 it('rejects an embedded protected key without returning its value',()=>{
  const c={...prepared,secretSlots:{...prepared.secretSlots,YOOKASSA_SECRET_KEY:{value:'private-value-do-not-echo'}}};
  const r=preparedProductionConfigurationReadiness(c);expect(r.status).toBe('V27_PRODUCTION_CONFIGURATION_INCOMPLETE');expect(JSON.stringify(r)).not.toContain('private-value');
 });
});
