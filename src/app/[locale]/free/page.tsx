import {notFound} from 'next/navigation';
import {cookies} from 'next/headers';
import {DiagnosticRunner} from '@/features/diagnostic/diagnostic-runner';
import {StartForm,ShortProfileForm,EmailForm,ClaimForm} from '@/features/acquisition/forms';
import {acquisitionEnabled,safeAttribution,acquisitionCookie,type SessionView} from '@/server/acquisition/contracts';
import {registrationPolicy} from '@/server/auth/legal';
import {ownSession,sessionRpc,claimRpc,type Choices} from '@/server/acquisition/service';
import {cookieContext} from '@/server/acquisition/context';
import {createAdminClient} from '@/server-runtime/supabase/admin';
import {loadQuestionnaire} from '@/server/diagnostic/questionnaire';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string>>}){
 if(!acquisitionEnabled())notFound();const policy=await registrationPolicy();let session:SessionView|null=null;let expired=false;
 try{session=await ownSession();}catch{expired=Boolean((await cookies()).get(acquisitionCookie));}
 if(session?.status==='in_progress'){
  const answers=Object.entries(session.answers).map(([question_id,value])=>({question_id,text_value:typeof value==='string'?value:null,numeric_value:typeof value==='number'?value:null,revision:session.revision}));
  const blocks=await loadQuestionnaire(createAdminClient(),session.methodology_version_id,answers);
  return <DiagnosticRunner anonymous key={session.id} data={{diagnostic:{id:session.id,revision:session.revision,current_block_id:session.current_block_id,company_id:''},company:{name:''},blocks}}/>;
 }
 const shell=(children:React.ReactNode)=><main id="main-content" className="mx-auto min-h-[65vh] max-w-2xl px-5 py-10 sm:py-14">{children}</main>;
 if(!session)return shell(<><p className="text-sm text-muted">Шаг 1 из 3 · Диагностика</p><h1 className="mt-3 text-3xl font-semibold">Начните бесплатную диагностику</h1><p className="mt-4 text-muted">Без регистрации. Оцените систему управления вашей компании; затем добавьте короткий контекст и получите персональный отчёт.</p>{expired?<><p role="alert" className="mt-5">Не удалось открыть сохранённую диагностику. Её срок мог истечь. По одному номеру восстановить ответы нельзя.</p><form action={async()=>{'use server';const {restartAnonymous}=await import('@/server/acquisition/actions');await restartAnonymous();}}><button className="mt-5 rounded-xl border border-line px-5 py-3">Начать новую диагностику</button></form></>:<StartForm policy={policy} attribution={safeAttribution(await searchParams) as Record<string,string>}/>}</>);
 const c=await cookieContext();
 if(session.status==='diagnostic_completed'){
  const refs=await sessionRpc<{industries:{industry_key:string;name:string}[];revenues:{revenue_key:string;name:string}[]}>('catalog',c.id,c.hash);
  return shell(<><p className="text-sm text-muted">Шаг 2 из 3 · Компания</p><h1 className="mt-3 text-3xl font-semibold">Диагностика завершена</h1><h2 className="mt-5 text-xl font-medium">Теперь познакомьте нас с компанией</h2><p className="mt-3 text-muted">Это поможет AI связать оценки с вашим бизнесом и подготовить более точные рекомендации.</p><ShortProfileForm {...refs} draft={session.company_context_draft}/></>);
 }
 if(session.status==='claim_pending'){
  const choices=await claimRpc<Choices>(c.id,c.hash,'choices');
  return shell(<><p className="text-sm text-muted">Шаг 3 из 3 · Получение отчёта</p><h1 className="mt-3 text-3xl font-semibold">К какой компании относится эта диагностика?</h1><ClaimForm choices={choices} policy={policy} renewConsent={session.consent_version!==policy.versions.data_processing || session.marketing_version!==policy.versions.marketing}/></>);
 }
 return shell(<><p className="text-sm text-muted">Шаг 3 из 3 · Получение отчёта</p><h1 className="mt-3 text-3xl font-semibold">Отчёт почти готов</h1><EmailForm policy={policy} renewConsent={session.consent_version!==policy.versions.data_processing} waiting={session.status==='email_pending'} cooldownSeconds={session.email_cooldown_seconds} mock={(process.env.ACQUISITION_EMAIL_PROVIDER??'mock')==='mock'}/></>);
}
