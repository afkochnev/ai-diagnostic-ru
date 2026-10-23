import {z} from 'zod';
import {annualOffer,receiptSettings} from './commercial';

// Validate the agreed, non-secret release profile independently of live runtime readiness.
// This helper never reads environment variables, calls a provider or installs configuration.
const profile=z.object({
 productionOrigin:z.literal('https://audit.iteam.ru'),
 supabaseOrigin:z.literal('https://fhvxqeaujjeiflanqsbg.supabase.co'),
 productionEnabled:z.literal(false),productionTouched:z.literal(false),
 paymentSlots:z.object({
  BILLING_PROVIDER:z.literal('yookassa'),YOOKASSA_TEST_MODE:z.literal('false'),
  YOOKASSA_SHOP_ID:z.string().regex(/^\d{1,20}$/),YOOKASSA_SECRET_KEY:z.null(),
  YOOKASSA_PRODUCTION_CONFIRMED:z.literal('true'),YOOKASSA_PRODUCTION_FISCAL_CONFIRMED:z.literal('true'),
  YOOKASSA_RECEIPT_SOLUTION:z.literal('yookassa'),YOOKASSA_RECEIPT_CONFIG_CONFIRMED:z.literal('true'),
  YOOKASSA_PAYMENT_MODE:z.literal('full_payment'),YOOKASSA_PAYMENT_MODE_CONFIRMED:z.literal('true'),
  YOOKASSA_RECEIPT_MEASURE:z.literal('another'),YOOKASSA_RECEIPT_REQUIRES_MEASURE:z.literal('true'),
  YOOKASSA_VAT_CODE:z.literal('1'),YOOKASSA_RECEIPT_REQUIRES_TAX_SYSTEM_CODE:z.literal('false'),
  YOOKASSA_TAX_SYSTEM_CODE:z.null(),YOOKASSA_TAX_SYSTEM_CODE_CONFIRMED:z.literal('false'),
  BILLING_ENABLED:z.literal('false'),YOOKASSA_RECONCILIATION_ENABLED:z.literal('false'),
  YOOKASSA_REFUNDS_ENABLED:z.literal('false').optional()
 }),
 secretSlots:z.record(z.string(),z.object({value:z.null()})),
 newCapabilityDefaults:z.object({BILLING_ENABLED:z.literal('false'),YOOKASSA_REFUNDS_ENABLED:z.literal('false')}),
 ownerApprovedProductConfiguration:z.object({
  payment_subject:z.literal('service'),description:z.literal(annualOffer.receiptItem.description),
  price:z.literal(annualOffer.price),amount_minor:z.literal(annualOffer.amount_minor),currency:z.literal('RUB'),
  payment_mode:z.literal('full_payment'),measure:z.literal('another'),vat_code:z.literal(1),vat_included:z.literal(false),
  productionFiscalConfirmation:z.literal(true)
 }),
 merchantConfirmation:z.object({
  productionShopId:z.string(),productionShopIdConfirmed:z.literal(true),
  actualReceiptSolution:z.literal('yookassa'),receiptSolutionConfirmed:z.literal(true),remoteVerificationPerformed:z.literal(false)
 }),
 stagingTestMerchantConfirmation:z.object({shopId:z.string()})
});

export function preparedProductionConfigurationReadiness(input:unknown){
 const parsed=profile.safeParse(input);
 let valid=false;
 if(parsed.success){
  const c=parsed.data;
  const env:Record<string,string|undefined>={NODE_ENV:'production',APP_URL:c.productionOrigin,SUPABASE_URL:c.supabaseOrigin};
  for(const[k,v]of Object.entries(c.paymentSlots))if(typeof v==='string')env[k]=v;
  try{
   const receipt=receiptSettings(env);
   valid=c.paymentSlots.YOOKASSA_SHOP_ID===c.merchantConfirmation.productionShopId
    &&c.paymentSlots.YOOKASSA_SHOP_ID!==c.stagingTestMerchantConfirmation.shopId
    &&!annualOffer.productionEnabled&&receipt.tax_system_code===undefined&&receipt.measure==='another';
  }catch{/* Return no caller values or validation payloads. */}
 }
 return{
  status:valid?'V27_PRODUCTION_CONFIGURATION_READY':'V27_PRODUCTION_CONFIGURATION_INCOMPLETE',
  configurationConfirmedByOwner:valid,preparedOnly:true,productionInstalled:false,
  productionBillingEnabled:false,remoteMerchantVerificationPerformed:false,productionTouched:false,externalCalls:0,
  errors:valid?[]:['PREPARED_PRODUCTION_PROFILE_INVALID']
 };
}
