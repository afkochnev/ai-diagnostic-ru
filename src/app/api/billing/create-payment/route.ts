import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireIdentity} from '@/server/auth/session';
import {requireAccountWrite} from '@/server/account/authorization';
import {authConfig} from '@/server/supabase/config';
import {enforceRateLimit} from '@/server/rate-limit';
import {createYooKassaPayment} from '@/server/billing/yookassa-service';
import {limitedBillingBody} from '@/server/billing/http';
import {yookassaConfigured,YooKassaError} from '@/server/billing/yookassa';
import {commercialAcceptanceSchema} from '@/server/billing/legal-contract';
export async function POST(request:Request){
 if(!yookassaConfigured())return NextResponse.json({error:'billing_unavailable'},{status:404});
 if(request.headers.get('origin')!==authConfig().APP_URL)return NextResponse.json({error:'billing_forbidden'},{status:403});
 const identity=await requireIdentity();
 try{
  const input=z.strictObject({account:z.uuid(),company:z.uuid().nullable().default(null),terms:commercialAcceptanceSchema}).parse(JSON.parse(await limitedBillingBody(request,1024)));
  await requireAccountWrite(input.account,identity.user.id);await enforceRateLimit(`billing:start:${identity.user.id}`,20,60);
  const url=await createYooKassaPayment(input.account,input.company,z.email().parse(identity.user.email),input.terms);
  return NextResponse.json({url});
 }catch(error){return NextResponse.json({error:'billing_payment_unavailable'},{status:error instanceof YooKassaError&&error.retryable?503:400});}
}
