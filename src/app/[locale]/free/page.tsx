import Link from 'next/link';
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
import {sessionLoadFailure,accessEmailSent,profileFromAnswers} from '@/server/acquisition/view-state';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string>>}){
 if(!acquisitionEnabled())notFound();const policy=await registrationPolicy();let session:SessionView|null=null;let failure:'new'|'expired'|'unavailable'='new';
 try{session=await ownSession();}catch(error){failure=sessionLoadFailure(error,Boolean((await cookies()).get(acquisitionCookie)));}
 const query=await searchParams;
 const shell=(children:React.ReactNode)=><main id="main-content" className="mx-auto min-h-[65vh] max-w-2xl px-5 py-10 sm:py-14">{children}</main>;
 if(session?.status==='in_progress'){
  if(query.paused==='1')return shell(<><p className="text-sm text-muted">Шаг 1 из 3 · Диагностика</p><h1 className="mt-3 text-3xl font-semibold">Ответы сохранены</h1><p className="mt-4 leading-relaxed text-muted">Вы можете сделать паузу. Продолжите в этом же браузере в течение 7 дней с начала диагностики — с того блока, на котором остановились.</p><p className="mt-3 text-sm text-muted">Регистрация сейчас не нужна. Имя и email понадобятся после завершения вопросов, чтобы получить отчёт.</p><Link href="/ru/free" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-6 py-3 font-semibold text-white">Продолжить диагностику</Link><Link href="/ru" className="mt-5 block underline">На главную</Link></>);
  const answers=Object.entries(session.answers).map(([question_id,value])=>({question_id,text_value:typeof value==='string'?value:null,numeric_value:typeof value==='number'?value:null,revision:session.revision}));
  const blocks=await loadQuestionnaire(createAdminClient(),session.methodology_version_id,answers);
  return <DiagnosticRunner anonymous key={session.id} data={{diagnostic:{id:session.id,revision:session.revision,current_block_id:session.current_block_id,company_id:''},company:{name:''},blocks}}/>;
 }
 if(!session&&failure==='unavailable')return shell(<><h1 className="text-3xl font-semibold">Не удалось загрузить диагностику</h1><p role="alert" className="mt-4 text-muted">Сохранённые ответы сейчас недоступны. Попробуйте загрузить страницу ещё раз. Если вы уже получили отчёт, он доступен в кабинете.</p><form method="get" action="/ru/free"><button className="mt-6 inline-flex rounded-xl bg-brand px-5 py-3 font-semibold text-white">Повторить загрузку</button></form><Link className="mt-4 block underline" href="/ru/account">Открыть кабинет</Link><details className="mt-8 rounded-xl border border-line p-4"><summary className="cursor-pointer font-medium">Начать новую диагностику</summary><p className="mt-3 text-sm text-muted">Этот браузер перестанет открывать предыдущую анонимную диагностику. Отчёты, уже сохранённые в аккаунте, останутся в кабинете.</p><form action={async()=>{'use server';const {restartAnonymous}=await import('@/server/acquisition/actions');await restartAnonymous();}}><button className="mt-4 rounded-xl border border-line px-5 py-3">Подтвердить и начать заново</button></form></details></>);
 if(!session)return shell(<><p className="text-sm text-muted">Шаг 1 из 3 · Диагностика</p><h1 className="mt-3 text-3xl font-semibold">Начните бесплатную диагностику</h1><p className="mt-4 text-muted">Без регистрации. Оцените систему управления вашей компании; затем добавьте короткий контекст и получите персональный отчёт.</p>{failure==='expired'?<><p role="alert" className="mt-5">Сохранённая диагностика больше недоступна по этой ссылке. Если вы уже получили отчёт, откройте кабинет. Для новой оценки начните диагностику снова.</p><Link className="mt-4 block underline" href="/ru/account">Открыть кабинет</Link><form action={async()=>{'use server';const {restartAnonymous}=await import('@/server/acquisition/actions');await restartAnonymous();}}><button className="mt-5 rounded-xl border border-line px-5 py-3">Начать новую диагностику</button></form></>:<StartForm policy={policy} attribution={safeAttribution(query) as Record<string,string>}/>}</>);
 const c=await cookieContext();
 if(session.status==='diagnostic_completed'){
  const refs=await sessionRpc<{industries:{industry_key:string;name:string}[];revenues:{revenue_key:string;name:string}[]}>('catalog',c.id,c.hash);
  const questions=await createAdminClient().from('questions').select('id,key').eq('version_id',session.methodology_version_id).in('key',['main_management_problem','main_company_goal']);
  // Failure to load optional prefills must not block completion of the profile.
  const draft=profileFromAnswers(questions.data??[],session.answers,session.company_context_draft);
  return shell(<><p className="text-sm text-muted">Шаг 2 из 3 · Компания</p><h1 className="mt-3 text-3xl font-semibold">Диагностика завершена</h1><h2 className="mt-5 text-xl font-medium">Теперь познакомьте нас с компанией</h2><p className="mt-3 text-muted">Это поможет AI связать оценки с вашим бизнесом и подготовить более точные рекомендации.</p><ShortProfileForm {...refs} draft={draft} prefilled={Boolean(draft.key_problems||draft.main_goals)}/></>);
 }
 if(session.status==='claim_pending'){
  const choices=await claimRpc<Choices>(c.id,c.hash,'choices');
  return shell(<><p className="text-sm text-muted">Шаг 3 из 3 · Получение отчёта</p><h1 className="mt-3 text-3xl font-semibold">К какой компании относится эта диагностика?</h1><ClaimForm choices={choices} policy={policy} renewConsent={session.consent_version!==policy.versions.data_processing || session.marketing_version!==policy.versions.marketing}/></>);
 }
 return shell(<><p className="text-sm text-muted">Шаг 3 из 3 · Получение отчёта</p><h1 className="mt-3 text-3xl font-semibold">Получите персональный отчёт</h1><EmailForm policy={policy} renewConsent={session.consent_version!==policy.versions.data_processing} waiting={session.status==='email_pending'&&accessEmailSent(session)} cooldownSeconds={session.email_cooldown_seconds} mock={(process.env.ACQUISITION_EMAIL_PROVIDER??'mock')==='mock'}/></>);
}
