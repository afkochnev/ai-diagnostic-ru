'use server';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {z} from 'zod';
import {requireAdmin} from '@/server/auth/admin';
import {authConfig} from '@/server/supabase/config';
import {enforceRateLimit} from '@/server/rate-limit';
import {yookassaVerificationConfigured} from './yookassa';
import {createFullYooKassaRefund} from './yookassa-service';

export async function requestFullRefund(form:FormData){
 const actor=await requireAdmin();
 if((await headers()).get('origin')!==authConfig().APP_URL||!yookassaVerificationConfigured()||process.env.YOOKASSA_REFUNDS_ENABLED!=='true')throw Error('billing_refunds_disabled');
 const checkout=z.uuid().parse(form.get('checkout'));
 if(form.get('refund_requested')!=='on'||form.get('amount')!=='480')throw Error('billing_refund_confirmation_required');
 await enforceRateLimit(`billing:refund:${actor.user.id}`,5,3600);
 let state='checked';
 try{await createFullYooKassaRefund(checkout);}catch{state='verification_required';}
 redirect(`/ru/admin/billing?refund=${state}`);
}
