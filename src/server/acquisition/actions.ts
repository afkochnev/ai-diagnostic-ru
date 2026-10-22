'use server';
import {randomUUID} from 'node:crypto';
import {redirect} from 'next/navigation';
import {cookies} from 'next/headers';
import {createAuthClient} from '@/server/supabase/server';
import {authConfig} from '@/server/supabase/config';
import {registrationPolicy} from '@/server/auth/legal';
import {getIdentity} from '@/server/auth/session';
import {guardOrigin,cookieContext,setContext,newSecret,hash,clearAnonymous,limit,ipLimit,visitCookie} from './context';
import {sessionRpc,claimRpc,ownSession,type ClaimResult,type Choices} from './service';
import {emailSchema,shortProfileSchema,safeAttribution,acquisitionCookie} from './contracts';
import {requestAccess,accessProof} from './email';
import {acquisitionStartEnabled} from '@/server-runtime/launch-gates';
export type AcquisitionState={error?:string;sent?:boolean};
const message=(e:unknown)=>e instanceof Error && e.message.includes('conflict')?'Данные изменились в другой вкладке. Обновите страницу.':e instanceof Error && e.message.includes('consent')?'Условия обновились. Подтвердите действующее согласие.':e instanceof Error && e.message.includes('advanced_required')?'В тарифе Free можно работать с одной компанией. Выберите существующую компанию или подключите Advanced.':e instanceof Error && e.message.includes('expired')?'Срок хранения диагностики истёк. Начните новую диагностику.':'Не удалось продолжить. Ваши сохранённые ответы остаются доступными до окончания срока хранения.';
export async function startAnonymous(_:AcquisitionState,form:FormData):Promise<AcquisitionState>{
 let id:string;
 try{
  if(!acquisitionStartEnabled())return {error:'Начало новой диагностики временно недоступно. Сохранённые результаты доступны в вашем кабинете.'};
  await guardOrigin();
  if(await getIdentity())redirect('/ru/account');
  if(form.get('consent')!=='on')return {error:'Подтвердите согласие на обработку данных.'};
  const policy=await registrationPolicy();
  if(form.get('consent_version')!==policy.versions.data_processing)return {error:'Условия обновились. Обновите страницу и подтвердите согласие.'};
  let visit;try{visit=await cookieContext(visitCookie);}catch{await ipLimit();const secret=newSecret();visit={id:randomUUID(),secret,hash:hash(secret)};await sessionRpc('visit_direct',visit.id,visit.hash,safeAttribution(Object.fromEntries(['utm_source','utm_medium','utm_campaign','utm_content','referrer_host','landing_variant'].map(k=>[k,form.get(k)]))));await setContext(visitCookie,visit.id,secret);}
  await limit('start',visit.id,15,3600);const secret=newSecret();
  let started:{id:string};
  try{started=await sessionRpc<{id:string}>('start',visit.id,visit.hash,{consent:true,consent_version:policy.versions.data_processing,session_hash:hash(secret)});}
  catch(e){
   if(!(e instanceof Error)||e.message!=='acquisition_session_exists')throw e;
   // An analytics cookie is never a recovery credential for confidential answers.
   const old=await sessionRpc<{attribution:Record<string,string>}>('visit_direct',visit.id,visit.hash);
   await ipLimit();const nextSecret=newSecret();visit={id:randomUUID(),secret:nextSecret,hash:hash(nextSecret)};
   await sessionRpc('visit_direct',visit.id,visit.hash,old.attribution);await setContext(visitCookie,visit.id,nextSecret);
   started=await sessionRpc<{id:string}>('start',visit.id,visit.hash,{consent:true,consent_version:policy.versions.data_processing,session_hash:hash(secret)});
  }
  id=started.id;await setContext(acquisitionCookie,id,secret);
 }catch(e){if(e instanceof Error && e.message==='NEXT_REDIRECT')throw e;return {error:message(e)};}
 redirect('/ru/free');
}
export async function saveShortProfile(_:AcquisitionState,form:FormData):Promise<AcquisitionState>{
 try{await guardOrigin();const c=await cookieContext();await limit('profile',c.id,20,3600);
  const fields=['name','industry_key','employee_count','products','key_problems','main_goals','country','customer_segments','sales_channels','annual_revenue_key','company_age_years','management_levels'];
  const parsed=shortProfileSchema.safeParse(Object.fromEntries(fields.map(k=>[k,form.get(k)??''])));
  if(!parsed.success)return {error:'Проверьте обязательные поля и числовые значения.'};
  await sessionRpc('profile',c.id,c.hash,{context:parsed.data});
 }catch(e){return {error:message(e)};}redirect('/ru/free');
}
export async function sendAccess(_:AcquisitionState,form:FormData):Promise<AcquisitionState>{
 let stage='origin';
 try{await guardOrigin();stage='context';const c=await cookieContext();stage='policy';const policy=await registrationPolicy();stage='session';const session=await ownSession();
  if(session.consent_version!==policy.versions.data_processing){
   if(form.get('consent')!=='on'||form.get('consent_version')!==policy.versions.data_processing)return {error:'Подтвердите действующее согласие на обработку данных.'};
   await sessionRpc('consent',c.id,c.hash,{consent:true,consent_version:policy.versions.data_processing});
  }
  const parsed=emailSchema.safeParse({email:form.get('email'),display_name:form.get('display_name'),marketing_granted:form.get('marketing_granted')==='on',marketing_version:form.get('marketing_version')});
  if(!parsed.success)return {error:'Укажите имя и корректный email.'};const input=parsed.data;
  stage='rate';await limit('email-session',c.id,5,3600);await limit('email-address',input.email,5,3600);
  stage='request';
  await requestAccess(c.id,c.hash,input);
  return {sent:true};
 }catch(e){const code=e instanceof Error && /^(acquisition_[a-z_]+|rate_limit[a-z_]+)$/.test(e.message)?e.message:'unavailable';console.warn('[acquisition]',{event:'access_request_failed',stage,code});return {sent:true};} // Identical safe external state for new/existing identities and provider failures; no automatic resend.
}
export async function confirmAccess(_:AcquisitionState,form:FormData):Promise<AcquisitionState>{
 void _;void form;
 let result:ClaimResult;
 try{await guardOrigin();const jar=await cookies(),ctx=jar.get('aca-access')?.value;const id=jar.get('aca-access-id')?.value;
  if(!ctx||!id)throw Error('acquisition_expired');const proof=accessProof(ctx,id);if(!proof)throw Error('acquisition_expired');
  await limit('verify',id,10,600);
  const client=await createAuthClient();const {data:{user}}=await client.auth.getUser();
  if(user?.email && user.email.toLowerCase()!==proof.email)return {error:'В браузере выполнен вход под другим адресом. Выйдите из него, затем откройте ссылку из письма снова.'};
  if(!user?.email_confirmed_at){const {data,error}=await client.auth.verifyOtp({token_hash:proof.tokenHash,type:proof.type});if(error||!data.user?.email_confirmed_at||data.user.email?.toLowerCase()!==proof.email)throw Error('acquisition_expired');}
  const secret=newSecret();result=await claimRpc<ClaimResult>(id,hash(secret),'recover');
  if(result.status!=='claimed'){
   await setContext(acquisitionCookie,id,secret);
   const s=await sessionRpc<import('./contracts').SessionView>('read',id,hash(secret));const policy=await registrationPolicy();
   if(s.consent_version===policy.versions.data_processing && s.marketing_version===policy.versions.marketing){
    const choices=await claimRpc<Choices>(id,hash(secret),'choices');
    if(choices.new_user || (choices.companies.length===0 && choices.accounts.length===1 && choices.accounts[0].can_create))result=await claimRpc<ClaimResult>(id,hash(secret),'claim',null,choices.new_user?null:choices.accounts[0].id);
   }
  }
  jar.set('aca-access','',{httpOnly:true,secure:authConfig().secure,sameSite:'lax',path:'/',maxAge:0});
  jar.set('aca-access-id','',{httpOnly:true,secure:authConfig().secure,sameSite:'lax',path:'/',maxAge:0});
 }catch(e){return {error:message(e)};}
 if(result.status==='claimed'&&result.diagnostic_id){await clearAnonymous();redirect(`/ru/diagnostics/${result.diagnostic_id}/result`);}redirect('/ru/free');
}
export async function finishClaim(_:AcquisitionState,form:FormData):Promise<AcquisitionState>{
 let result:ClaimResult;
 try{await guardOrigin();const c=await cookieContext();await limit('claim',c.id,20,600);
  const policy=await registrationPolicy();const s=await ownSession();if(s.consent_version!==policy.versions.data_processing || s.marketing_version!==policy.versions.marketing){
   if(form.get('consent')!=='on'||form.get('consent_version')!==policy.versions.data_processing)return {error:'Подтвердите действующую версию согласия.'};
   await sessionRpc('consent',c.id,c.hash,{consent:true,consent_version:policy.versions.data_processing,marketing_version:policy.versions.marketing,marketing_granted:form.get('marketing_granted')==='on'});
  }
  result=await claimRpc<ClaimResult>(c.id,c.hash,'claim',String(form.get('company_id')??'')||null,String(form.get('account_id')??'')||null);
  if(result.status!=='claimed'||!result.diagnostic_id)return {error:'Укажите, к какой компании относится диагностика.'};await clearAnonymous();
 }catch(e){return {error:message(e)};}redirect(`/ru/diagnostics/${result.diagnostic_id}/result`);
}

export async function restartAnonymous(){await guardOrigin();await clearAnonymous();(await cookies()).set(visitCookie,'',{httpOnly:true,secure:authConfig().secure,sameSite:'lax',path:'/',maxAge:0});redirect('/ru/free');}
