import{annualOffer,productionBillingEnvironment,yookassaRuntimeMode,receiptSettings}from'./commercial';
// Offline, value-free configuration report. This never calls YooKassa or changes billing state.
export function productionBillingReadiness(env:Record<string,string|undefined>){
 const blockers:string[]=[];
 if(!productionBillingEnvironment(env))blockers.push('PRODUCTION_DEPLOYMENT_IDENTITY_UNCONFIRMED');
 if(yookassaRuntimeMode(env)!=='production')blockers.push('PRODUCTION_MERCHANT_CONFIGURATION_UNCONFIRMED');
 if(!annualOffer.productionEnabled)blockers.push('PRODUCTION_COMMERCIAL_ENABLEMENT_NOT_APPROVED');
 if(env.BILLING_ENABLED!=='true')blockers.push('PRODUCTION_BILLING_DISABLED');
 let fiscalConfirmed=false;
 try{receiptSettings(env);fiscalConfirmed=env.YOOKASSA_PRODUCTION_FISCAL_CONFIRMED==='true';}catch{/* Report only a safe gate, never caller values. */}
 if(!fiscalConfirmed)blockers.push('PRODUCTION_FISCAL_CONFIGURATION_UNCONFIRMED');
 return{status:blockers.length?'AWAITING_PRODUCTION_CONFIGURATION':'LOCAL_CONFIGURATION_VALID_REMOTE_PREFLIGHT_STILL_REQUIRED',adapterSupportsProduction:true,commercialProductionEnabled:annualOffer.productionEnabled,creationSwitchOn:env.BILLING_ENABLED==='true',reconciliationSwitchOn:env.YOOKASSA_RECONCILIATION_ENABLED==='true',refundInitiationSwitchOn:env.YOOKASSA_REFUNDS_ENABLED==='true',fiscalConfirmed,blockers,remoteMerchantVerificationPerformed:false,productionDatabaseActivationVerified:false,externalCalls:0};
}
