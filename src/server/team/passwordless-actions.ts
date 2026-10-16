"use server";
import {createHmac} from "node:crypto";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {createAuthClient} from "@/server/supabase/server";
import {authConfig} from "@/server/supabase/config";
import {clearRecovery} from "@/server/auth/recovery";
import {getIdentity,requireIdentity} from "@/server/auth/session";
import {buildSignupMetadata} from "@/server/auth/registration-contract";
import {registrationPolicy} from "@/server/auth/legal";
import {enforceRateLimit} from "@/server/rate-limit";
import {sealTeamChallenge} from "./passwordless-challenge";
import {teamRpc} from "./service";
import {clearTeamEntry,teamEntryContext} from "./entry-context";
export type TeamPasswordlessState={phase?:"ready"|"waiting"|"expired"|"error"|"wrong";error?:string;authRequestAccepted?:boolean;sentAt?:number;expires?:number;contextExpires?:number};
function failure(error:unknown):TeamPasswordlessState{
  const code=error instanceof Error?error.message:"";
  const messages:Record<string,string>={
    team_context_expired:"Срок текущей сессии приглашения истёк. Откройте письмо-приглашение снова.",
    team_invitation_unavailable:"Приглашение недоступно. Ссылка могла быть заменена, отозвана или срок сбора завершён.",
    rate_limited:"Слишком много попыток. Подождите перед повторной отправкой или проверкой.",
    team_consent_required:"Подтвердите согласие на обработку данных.",
    team_policy_changed:"Условия обновились. Обновите страницу и подтвердите согласие ещё раз.",
    team_code_invalid:"Код неверен или срок его действия истёк.",
    team_wrong_account:"Это приглашение предназначено для другого адреса.",
  };
  return {phase:code==="team_context_expired" || code==="team_invitation_unavailable"?"expired":code==="team_wrong_account"?"wrong":"error",authRequestAccepted:false,error:messages[code]??"Не удалось продолжить. Попробуйте позже."};
}
async function safeFailure(error:unknown){
  const result=failure(error);
  if(result.phase==="expired")await clearTeamEntry();
  return result;
}
async function consent(form:FormData){
  if(form.get("data_processing_consent")!=="on")throw new Error("team_consent_required");
  const policy=await registrationPolicy();
  for(const [kind,version] of Object.entries(policy.versions))if(form.get(`${kind}_version`)!==version)throw new Error("team_policy_changed");
  return policy;
}
async function acceptVerified(){
  const identity=await requireIdentity();
  let participant:string;
  try{
    const c=await teamEntryContext(true),client=await createAuthClient();
    const {data:{user},error}=await client.auth.getUser();
    if(error || !user?.email_confirmed_at || user.email?.toLowerCase()!==c.target.email)throw new Error("team_wrong_account");
    await enforceRateLimit(`team-accept:${identity.user.id}`,20,3600);
    participant=await teamRpc<string>("accept_team_invitation",{p_token:c.token});
    await clearTeamEntry();
  }catch(error){return safeFailure(error);}
  revalidatePath("/","layout");
  redirect(`/ru/team/responses/${participant}`);
}
export async function sendTeamCodeAction(_:TeamPasswordlessState,form:FormData):Promise<TeamPasswordlessState>{
  try{
    const c=await teamEntryContext(true),policy=await consent(form);
    const identity=await getIdentity();
    if(identity?.user.email && identity.user.email.toLowerCase()!==c.target.email)throw new Error("team_wrong_account");
    const matching=Boolean(identity?.user.email_confirmed_at && identity.user.email?.toLowerCase()===c.target.email);
    if(!matching){
      await enforceRateLimit(`team-code-cooldown:${c.hash}`,1,60);
      await enforceRateLimit(`team-code-send:${c.hash}`,5,3600);
      const mailbox=createHmac("sha256",c.secret).update(c.target.email).digest("hex");
      await enforceRateLimit(`team-code-mailbox:${mailbox}`,5,3600);
      await enforceRateLimit("team-code-send:global",100,3600);
      const client=await createAuthClient();
      const {error}=await client.auth.signInWithOtp({email:c.target.email,options:{shouldCreateUser:c.target.create_user,emailRedirectTo:`${authConfig().APP_URL}/ru/team/confirm`,...(c.target.create_user?{data:buildSignupMetadata({full_name:c.target.display_name,data_processing_consent:true,marketing_consent:false,versions:Object.fromEntries(Object.entries(policy.versions).map(([k,v])=>[`${k}_version`,v]))})}:{})}});
      if(error)throw new Error(error.status===429?"rate_limited":"team_auth_unavailable");
      const now=Date.now();
      c.jar.set("team-email-challenge",sealTeamChallenge(c.target.email,c.hash,c.secret,now),{httpOnly:true,sameSite:"lax",secure:authConfig().secure,path:"/ru/team",maxAge:600});
      console.info("[team-auth]",{event:"auth_request",authRequestAccepted:true,mailboxReceiptConfirmed:false});
      return {phase:"waiting",authRequestAccepted:true,sentAt:now,expires:now+600000,contextExpires:c.expires};
    }
  }catch(error){return safeFailure(error);}
  return acceptVerified();
}
export async function verifyTeamCodeAction(_:TeamPasswordlessState,form:FormData):Promise<TeamPasswordlessState>{
  try{
    const c=await teamEntryContext(true),code=String(form.get("code")??"").trim();
    if(!c.challenge || !/^[0-9]{6,10}$/.test(code))throw new Error("team_code_invalid");
    if(c.challenge.email!==c.target.email)throw new Error("team_invitation_unavailable");
    const client=await createAuthClient();
    // Do not prime React-cached getIdentity before establishing the new session.
    const {data:{user:currentUser}}=await client.auth.getUser();
    if(currentUser?.email && currentUser.email.toLowerCase()!==c.target.email)throw new Error("team_wrong_account");
    await enforceRateLimit(`team-code-verify:${c.hash}`,10,600);
    const {data,error}=await client.auth.verifyOtp({email:c.target.email,token:code,type:"email"});
    if(error || !data.session || !data.user?.email_confirmed_at || data.user.email?.toLowerCase()!==c.target.email)throw new Error("team_code_invalid");
    await clearRecovery();
  }catch(error){return safeFailure(error);}
  return acceptVerified();
}
export async function confirmTeamEmailAction(_:TeamPasswordlessState,form:FormData):Promise<TeamPasswordlessState>{
  try{
    const c=await teamEntryContext(true),hash=String(form.get("token_hash")??"");
    if(!c.challenge || c.challenge.email!==c.target.email)throw new Error("team_context_expired");
    if(!/^[A-Za-z0-9_-]{32,256}$/.test(hash) || form.get("type")!=="email")throw new Error("team_code_invalid");
    const client=await createAuthClient();
    // Do not prime React-cached getIdentity before establishing the new session.
    const {data:{user:currentUser}}=await client.auth.getUser();
    if(currentUser?.email && currentUser.email.toLowerCase()!==c.target.email)throw new Error("team_wrong_account");
    await enforceRateLimit(`team-code-verify:${c.hash}`,10,600);
    const {data,error}=await client.auth.verifyOtp({token_hash:hash,type:"email"});
    if(error || !data.session || !data.user?.email_confirmed_at || data.user.email?.toLowerCase()!==c.target.email)throw new Error("team_code_invalid");
    await clearRecovery();
    console.info("[team-auth]",{event:"email_verification",verificationSucceeded:true});
  }catch(error){return safeFailure(error);}
  return acceptVerified();
}
