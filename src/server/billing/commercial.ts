import config from '../../../docs/v26b-commercial-config.json';
// This file consumes the user-approved commercial contract; env never supplies price or term.
export const annualOffer = Object.freeze({ ...config, key: 'yookassa-advanced-annual-480-rub' });
export function billingEnvironmentAllowed(env: Record<string,string|undefined>) {
 const staging=env.APP_URL==='https://ai-diagnostic-staging-web.onrender.com'&&env.SUPABASE_URL==='https://vflgxgdwlftlyjslyrmo.supabase.co';
 const local=env.NODE_ENV!=='production'&&/^http:\/\/127\.0\.0\.1:\d+$/.test(env.APP_URL??'')&&/^http:\/\/127\.0\.0\.1:\d+$/.test(env.SUPABASE_URL??'');
 return staging||local;
}
// Exact deployment identity is independent of merchant secrets and browser input.
export function productionBillingEnvironment(env: Record<string,string|undefined>) {
 return env.NODE_ENV==='production'&&env.APP_URL==='https://audit.iteam.ru'&&env.SUPABASE_URL==='https://fhvxqeaujjeiflanqsbg.supabase.co';
}
export function yookassaRuntimeMode(env: Record<string,string|undefined>): 'test'|'production'|null {
 if(env.BILLING_PROVIDER!=='yookassa'||!/^\d{1,20}$/.test(env.YOOKASSA_SHOP_ID??''))return null;
 if(billingEnvironmentAllowed(env)&&env.YOOKASSA_TEST_MODE==='true'&&/^test_[A-Za-z0-9_-]{8,}$/.test(env.YOOKASSA_SECRET_KEY??''))return 'test';
 if(productionBillingEnvironment(env)&&env.YOOKASSA_TEST_MODE==='false'&&env.YOOKASSA_PRODUCTION_CONFIRMED==='true'&&/^live_[A-Za-z0-9_-]{8,}$/.test(env.YOOKASSA_SECRET_KEY??''))return 'production';
 return null;
}
export const paymentModes=[annualOffer.payment_mode] as const;
export function receiptSettings(env: Record<string,string|undefined>) {
 const mode=env.YOOKASSA_PAYMENT_MODE;
 if(productionBillingEnvironment(env)&&env.YOOKASSA_PRODUCTION_FISCAL_CONFIRMED!=='true')throw Error('billing_receipt_unconfirmed');
 if(env.YOOKASSA_RECEIPT_CONFIG_CONFIRMED!=='true'||env.YOOKASSA_PAYMENT_MODE_CONFIRMED!=='true'||!paymentModes.includes(mode as typeof paymentModes[number]))throw Error('billing_receipt_unconfirmed');
 if(env.YOOKASSA_VAT_CODE!==undefined&&env.YOOKASSA_VAT_CODE!==String(annualOffer.vat_code))throw Error('billing_receipt_invalid');
 const solution=env.YOOKASSA_RECEIPT_SOLUTION;
 if(!['yookassa','external'].includes(solution??''))throw Error('billing_receipt_unconfirmed');
 const measure=env.YOOKASSA_RECEIPT_MEASURE;
 if(measure!==undefined&&!['piece','another'].includes(measure))throw Error('billing_receipt_invalid');
 if((solution==='yookassa'||env.YOOKASSA_RECEIPT_REQUIRES_MEASURE==='true')&&!measure)throw Error('billing_receipt_unconfirmed');
 const required=env.YOOKASSA_RECEIPT_REQUIRES_TAX_SYSTEM_CODE;
 if(solution==='yookassa'&&required==='true')throw Error('billing_receipt_invalid');
 if(required!=='true'&&required!=='false')throw Error('billing_receipt_unconfirmed');
 let taxSystemCode:number|undefined;
 if(required==='true'){
  // USN subtype is a merchant/accounting decision, never inferred from VAT or price.
  if(env.YOOKASSA_TAX_SYSTEM_CODE_CONFIRMED!=='true'||!['2','3'].includes(env.YOOKASSA_TAX_SYSTEM_CODE??''))throw Error('billing_tax_system_unconfirmed');
  taxSystemCode=Number(env.YOOKASSA_TAX_SYSTEM_CODE);
 }
 return {payment_mode:mode as typeof paymentModes[number],tax_system_code:taxSystemCode,measure};
}
