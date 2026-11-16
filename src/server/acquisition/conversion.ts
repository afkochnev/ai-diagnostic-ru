'use server';
import {redirect} from 'next/navigation';
import {z} from 'zod';
import {requireIdentity} from '@/server/auth/session';
import {requireCompanyWrite} from '@/server/account/authorization';
import {getAccountPlan} from '@/server/entitlements';
import {guardOrigin} from './context';
import {trackInteraction} from './service';
export async function requestAdvanced(companyId:string,surface:'individual_report'|'dashboard'|'diagnostics_hub'|'team_explainer'){
 await guardOrigin();const identity=await requireIdentity();const company=await requireCompanyWrite(z.uuid().parse(companyId),identity.user.id);
 const plan=await getAccountPlan(company.account_id);
 if(plan.entitlements.team_diagnostics)redirect(`/ru/companies/${company.id}/diagnostics?new=1&type=team#team-create`);
 try {
  await trackInteraction('advanced_cta_clicked',company.id,null,surface);
 } catch {
  console.warn('[acquisition]',{event:'advanced_cta_tracking_unavailable'});
 }
 redirect(`/ru/account/plan?account=${company.account_id}&company=${company.id}`);
}
