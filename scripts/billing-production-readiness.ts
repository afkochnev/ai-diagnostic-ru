// Offline prepared-slot audit only. No credentials read from process.env, no network or writes.
import{readFileSync}from'node:fs';
import{productionBillingReadiness}from'../src/server/billing/readiness';
import{preparedProductionConfigurationReadiness}from'../src/server/billing/prepared-configuration';
const config=JSON.parse(readFileSync(new URL('../docs/v27-production-configuration.json',import.meta.url),'utf8'));
const slots:Record<string,string|undefined>={NODE_ENV:'production',APP_URL:config.productionOrigin,SUPABASE_URL:config.supabaseOrigin};
for(const[k,v]of Object.entries(config.paymentSlots))if(typeof v==='string')slots[k]=v;
console.log(JSON.stringify({...preparedProductionConfigurationReadiness(config),runtime:productionBillingReadiness(slots),source:'Owner-confirmed prepared configuration only; no installed production environment or remote verification'},null,2));
