import {NextResponse} from 'next/server';
import {yookassaVerificationConfigured,YooKassaError} from '@/server/billing/yookassa';
import {processYooKassaWebhook} from '@/server/billing/yookassa-service';
import {limitedBillingBody} from '@/server/billing/http';
import {enforceRateLimit} from '@/server/rate-limit';
export async function POST(request:Request){
 if(!yookassaVerificationConfigured())return NextResponse.json({error:'billing_unavailable'},{status:404});
 try {
  const body=await limitedBillingBody(request);
  // Global bounded work protects the privileged lookup/GET. Never trust X-Forwarded-For as verification.
  await enforceRateLimit('billing:yookassa:webhook',120,60);
  const result=await processYooKassaWebhook(body);
  return NextResponse.json({status:result.status},{status:result.status==='retryable'?503:result.status==='rejected'?422:200});
 }catch(e){
  const status=e instanceof YooKassaError?(e.retryable?503:400):e instanceof Error&&e.message==='billing_body_too_large'?413:503;
  return NextResponse.json({error:'billing_verification_failed'},{status});
 }
}
