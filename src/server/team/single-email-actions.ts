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

export async function continueSingleEmailAction(_:TeamPasswordlessState,form:FormData):Promise<TeamPasswordlessState>{
 let participant:string;
 try{
  const c=await teamEntryContext(true);
  if(!c.proof)throw new Error("team_context_expired");
  if(form.get("data_processing_consent")!=="on")throw new Error("team_consent_required");
  const policy=await registrationPolicy();
  for(const [kind,version] of Object.entries(policy.versions))if(form.get(`${kind}_version`)!==version)throw new Error("team_policy_changed");
  const client=await createAuthClient();
  // A pending identity has no application role. Do not use cached getIdentity
  // until the consent-gated database transaction has provisioned that identity.
  const {data:{user:current}}=await client.auth.getUser();
  if(current?.email && current.email.toLowerCase()!==c.target.email)throw new Error("team_wrong_account");
  await enforceRateLimit(`team-single-verify:${c.hash}`,10,600);
  if(!current?.email_confirmed_at){
   const {data,error}=await client.auth.verifyOtp({token_hash:c.proof.tokenHash,type:c.proof.type});
   if(error || !data.session || !data.user?.email_confirmed_at || data.user.email?.toLowerCase()!==c.target.email)throw new Error("team_email_invalid");
  }
  const data=await teamRpc<string>("finalize_team_invitation_identity",{p_token:c.token,p_consent:true,p_data_version:policy.versions.data_processing,p_marketing_version:policy.versions.marketing});
  if(typeof data!=="string" || !/^[a-f0-9-]{36}$/.test(data))throw new Error("team_invitation_unavailable");
  participant=data;
  await clearRecovery();
  await clearTeamEntry();
  console.info("[team-auth]",{event:"single_email_acceptance",verificationSucceeded:true});
 }catch(error){
  const code=error instanceof Error?error.message:"";
  const messages:Record<string,string>={
   team_context_expired:"Срок ссылки для входа истёк. Попросите организатора отправить новое приглашение.",
   team_consent_required:"Подтвердите согласие на обработку данных.",
   team_policy_changed:"Условия обновились. Обновите страницу и подтвердите согласие ещё раз.",
   team_wrong_account:"Это приглашение предназначено для другого адреса.",
   team_email_invalid:"Ссылка для входа недействительна или уже использована. Попросите организатора отправить новое приглашение.",
   team_invitation_unavailable:"Приглашение недоступно. Оно могло быть заменено, отозвано или сбор ответов завершён.",
   rate_limited:"Слишком много попыток. Подождите перед повторной проверкой.",
  };
  const expired=["team_context_expired","team_invitation_unavailable","team_email_invalid"].includes(code);
  if(expired)await clearTeamEntry();
  return {phase:expired?"expired":code==="team_wrong_account"?"wrong":"error",error:messages[code]??"Не удалось продолжить. Попробуйте позже.",authRequestAccepted:false};
 }
 revalidatePath("/","layout");
 redirect(`/ru/team/responses/${participant}`);
}
