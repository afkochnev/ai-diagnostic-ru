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
import {createRuntimeEvidenceChannel} from '@/server-runtime/team-auth-evidence';

export async function continueSingleEmailAction(_:TeamPasswordlessState,form:FormData):Promise<TeamPasswordlessState>{
 let participant:string;
 try{
  const c=await teamEntryContext(true);
  if(!c.proof)throw new Error("team_context_expired");
  if(form.get("data_processing_consent")!=="on")throw new Error("team_consent_required");
  const policy=await registrationPolicy();
  for(const [kind,version] of Object.entries(policy.versions))if(form.get(`${kind}_version`)!==version)throw new Error("team_policy_changed");
  const w2='w2' in c?c.w2:undefined;
  if(w2&&form.has('marketing_consent')&&form.get('marketing_consent')!=='false')throw Error('team_policy_changed');
  if(w2)createRuntimeEvidenceChannel({runId:w2.controlled.run_id,planHash:w2.controlled.approved_plan_hash??''});
  const client=await createAuthClient();
  // A pending identity has no application role. Do not use cached getIdentity
  // until the consent-gated database transaction has provisioned that identity.
  const {data:{user:current}}=await client.auth.getUser();
  if(current?.email && current.email.toLowerCase()!==c.target.email)throw new Error("team_wrong_account");
  if(w2&&current&&current.id!==w2.proof.userId)throw Error('team_wrong_account');
  // A previously confirmed W2 identity is never a substitute for this window's
  // one personally consented, trace-backed verification.
  if(w2&&current?.email_confirmed_at)throw Error('controlled_team_unavailable');
  await enforceRateLimit(`team-single-verify:${c.hash}`,10,600);
  const verification=w2?await reserveControlledTeamW2Verification(w2.controlled,{participantId:w2.proof.participantId,userId:w2.proof.userId,invitationHash:c.hash}):null;
  if(!current?.email_confirmed_at){
   const verificationClient=w2&&verification?await createAuthClient(controlledTeamW2VerifyFetch(w2.controlled,verification,w2.proof)):client;
   const {data,error}=await verificationClient.auth.verifyOtp({token_hash:c.proof.tokenHash,type:c.proof.type});
   if(error || !data.session || !data.user?.email_confirmed_at || data.user.email?.toLowerCase()!==c.target.email||w2&&data.user.id!==w2.proof.userId)throw new Error("team_email_invalid");
  }
  const data=w2&&verification?await teamRpc<string>('finalize_controlled_team_w2_identity',{p_window_id:w2.proof.windowId,p_verification_id:verification.verification_id,p_invitation_hash:c.hash,p_consent:true,p_data_version:policy.versions.data_processing,p_marketing_version:policy.versions.marketing}):await teamRpc<string>("finalize_team_invitation_identity",{p_token:c.token,p_consent:true,p_data_version:policy.versions.data_processing,p_marketing_version:policy.versions.marketing});
  if(typeof data!=="string" || !/^[a-f0-9-]{36}$/.test(data))throw new Error("team_invitation_unavailable");
  if(w2&&data!==w2.proof.participantId)throw Error('team_invitation_unavailable');
  participant=data;
  await clearRecovery();
  await clearTeamEntry();
  console.info("[team-auth]",{event:"single_email_acceptance",verificationSucceeded:true});
 }catch(error){
  const code=error instanceof Error?error.message:"";
  const messages:Record<string,string>={
   team_context_expired:"Ссылка недоступна или срок доступа истёк. Обратитесь к организатору.",
   team_consent_required:"Подтвердите согласие на обработку данных.",
   team_policy_changed:"Условия обновились. Обновите страницу и подтвердите согласие ещё раз.",
   team_wrong_account:"Это приглашение предназначено для другого адреса.",
   team_email_invalid:"Ссылка для входа недоступна или уже использована. Обратитесь к организатору.",
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
