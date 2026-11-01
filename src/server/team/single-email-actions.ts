"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {createAuthClient} from "@/server/supabase/server";
import {registrationPolicy} from "@/server/auth/legal";
import {clearRecovery} from "@/server/auth/recovery";
import {enforceRateLimit} from "@/server/rate-limit";
import {clearTeamEntry,teamEntryContext} from "./entry-context";
import type {TeamPasswordlessState} from "./passwordless-actions";
import {teamRpc} from "./service";
import {reserveControlledTeamW2Verification} from '@/server-runtime/team-smoke';
import {controlledTeamW2VerifyFetch} from './controlled-auth-transport';
import {isInvitationDayGrant,openInvitationAuthProof} from "./invitation-auth-proof";
import {claimInvitationDayAccess} from "./day-access";

export async function continueSingleEmailAction(_:TeamPasswordlessState,form:FormData):Promise<TeamPasswordlessState>{
 let participant:string;
 let day=false;
 try{
  const c=await teamEntryContext(true);
  if(!c.proof)throw new Error("team_context_expired");
  if(form.get("data_processing_consent")!=="on")throw new Error("team_consent_required");
  const policy=await registrationPolicy();
  for(const [kind,version] of Object.entries(policy.versions))if(form.get(`${kind}_version`)!==version)throw new Error("team_policy_changed");
  const w2='w2' in c?c.w2:undefined;
  if(w2&&form.has('marketing_consent')&&form.get('marketing_consent')!=='false')throw Error('team_policy_changed');
  day=isInvitationDayGrant(c.proof);
  // One bounded attempt finishes well inside the database's 120-second lease.
  const deadline=day?AbortSignal.timeout(45000):null;
  const boundedFetch:typeof fetch=(input,init)=>fetch(input,{...init,signal:deadline?AbortSignal.any([deadline,...(init?.signal?[init.signal]:[])]):init?.signal});
  const client=await createAuthClient(day?boundedFetch:undefined);
  // A pending identity has no application role. Do not use cached getIdentity
  // until the consent-gated database transaction has provisioned that identity.
  const {data:{user:current},error:currentError}=await client.auth.getUser();
  if(day&&currentError&&currentError.name!=="AuthSessionMissingError")throw Error("team_auth_retry");
  if(current?.email && current.email.toLowerCase()!==c.target.email)throw new Error("team_wrong_account");
  if(w2&&current&&current.id!==w2.proof.userId)throw Error('team_wrong_account');
  // A previously confirmed W2 identity is never a substitute for this window's
  // one personally consented, trace-backed verification.
  if(w2&&current?.email_confirmed_at)throw Error('controlled_team_unavailable');
  await enforceRateLimit(`team-single-verify:${c.hash}`,10,600);
  const verification=w2?await reserveControlledTeamW2Verification(w2.controlled,{participantId:w2.proof.participantId,userId:w2.proof.userId,invitationHash:c.hash}):null;
  if(!current?.email_confirmed_at){
   let proof=c.proof;
   if(day){
    const fresh=await claimInvitationDayAccess(c.proof as import("./invitation-auth-proof").InvitationDayGrant,boundedFetch);
    const opened=openInvitationAuthProof(fresh.envelope,c.hash,c.secret);
    if(!opened||isInvitationDayGrant(opened))throw Error("team_auth_retry");
    proof=opened;
   }
   const verificationClient=w2&&verification?await createAuthClient(controlledTeamW2VerifyFetch(w2.controlled,verification,w2.proof)):client;
   if(isInvitationDayGrant(proof))throw Error("team_auth_retry");
   const {data,error}=await verificationClient.auth.verifyOtp({token_hash:proof.tokenHash,type:proof.type});
   if(error || !data.session || !data.user?.email_confirmed_at || data.user.email?.toLowerCase()!==c.target.email||w2&&data.user.id!==w2.proof.userId)throw new Error(day?"team_auth_retry":"team_email_invalid");
  }
  if(deadline?.aborted)throw Error("team_auth_retry");
  const finalizeArgs={p_token:c.token,p_consent:true,p_data_version:policy.versions.data_processing,p_marketing_version:policy.versions.marketing};
  let data:unknown;
  if(day){
   const result=await (client as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>}).rpc("finalize_team_invitation_identity",finalizeArgs);
   if(result.error)throw Error("team_auth_retry");data=result.data;
  }else data=w2&&verification?await teamRpc<string>('finalize_controlled_team_w2_identity',{p_window_id:w2.proof.windowId,p_verification_id:verification.verification_id,p_invitation_hash:c.hash,p_consent:true,p_data_version:policy.versions.data_processing,p_marketing_version:policy.versions.marketing}):await teamRpc<string>("finalize_team_invitation_identity",finalizeArgs);
  if(typeof data!=="string" || !/^[a-f0-9-]{36}$/.test(data))throw new Error("team_invitation_unavailable");
  if(w2&&data!==w2.proof.participantId)throw Error('team_invitation_unavailable');
  participant=data;
  await clearRecovery();
  await clearTeamEntry();
  console.info("[team-auth]",{event:"single_email_acceptance",verificationSucceeded:true});
 }catch(error){
  const rawCode=error instanceof Error?error.message:"";
  const code=day&&!['team_invitation_unavailable','team_context_expired','team_email_invalid','team_consent_required','team_policy_changed','team_wrong_account','rate_limited','team_auth_busy'].includes(rawCode)?'team_auth_retry':rawCode;
  const messages:Record<string,string>={
   team_context_expired:"Ссылка недоступна или срок доступа истёк. Обратитесь к организатору.",
   team_consent_required:"Подтвердите согласие на обработку данных.",
   team_policy_changed:"Условия обновились. Обновите страницу и подтвердите согласие ещё раз.",
   team_wrong_account:"Это приглашение предназначено для другого адреса.",
   team_email_invalid:"Ссылка для входа недоступна или уже использована. Обратитесь к организатору.",
   team_auth_busy:"Вход по этой ссылке уже проверяется. Подождите до 2 минут и нажмите «Продолжить» ещё раз.",
   team_auth_retry:"Временно не удалось подтвердить вход. Ссылка сохранена. Повторите через 2 минуты. Если проблема повторится, попросите организатора обновить приглашение.",
   team_invitation_unavailable:"Приглашение недоступно. Оно могло быть заменено, отозвано или сбор ответов завершён.",
   rate_limited:"Слишком много попыток. Подождите перед повторной проверкой.",
   controlled_team_unavailable:'Ссылка недоступна или срок доступа истёк. Обратитесь к организатору.',
   controlled_team_budget_consumed:'Продолжить по этой ссылке сейчас невозможно. Обратитесь к организатору.',
  };
  const expired=["team_context_expired","team_invitation_unavailable","team_email_invalid","controlled_team_unavailable","controlled_team_budget_consumed"].includes(code);
  if(expired)await clearTeamEntry();
  return {phase:expired?"expired":code==="team_wrong_account"?"wrong":"error",error:messages[code]??"Не удалось продолжить. Попробуйте позже.",authRequestAccepted:false};
 }
 revalidatePath("/","layout");
 redirect(`/ru/team/responses/${participant}`);
}
