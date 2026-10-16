"use server";
import { createHash, createHmac } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/server-runtime/supabase/admin";
import { createAuthClient } from "@/server/supabase/server";
import { authConfig } from "@/server/supabase/config";
import { clearRecovery } from "@/server/auth/recovery";
import { requireIdentity } from "@/server/auth/session";
import { buildSignupMetadata } from "@/server/auth/registration-contract";
import { registrationPolicy } from "@/server/auth/legal";
import { enforceRateLimit } from "@/server/rate-limit";
import { teamFoundationEnabled } from "./capabilities";
import { openInvitation } from "./invitation-envelope";
import { openTeamChallenge, sealTeamChallenge } from "./passwordless-challenge";
import { teamRpc } from "./service";
import { z } from "zod";
export type TeamPasswordlessState = { error?: string; sent?: boolean };
const invitationCookie="team-invitation", challengeCookie="team-email-challenge";
const targetSchema=z.object({ email:z.email().max(254),display_name:z.string().trim().min(1).max(100),create_user:z.boolean() }).strict();
async function pendingInvitation() {
  if (!teamFoundationEnabled() || (await headers()).get("origin")!==authConfig().APP_URL) throw new Error("team_auth_unavailable");
  const jar=await cookies(), token=openInvitation(jar.get(invitationCookie)?.value,authConfig().AUTH_FLOW_SECRET);
  if (!token) throw new Error("team_invitation_unavailable");
  const hash=createHash("sha256").update(token).digest("hex");
  return {jar,token,hash};
}
async function target(hash: string) {
  const {data,error}=await createAdminClient().rpc("resolve_team_invitation_auth",{p_token_hash:hash});
  if (error) throw new Error("team_invitation_unavailable");
  return targetSchema.parse(data);
}
function failure(error: unknown): TeamPasswordlessState {
  const code=error instanceof Error?error.message:"";
  if (code==="rate_limited") return {error:"Слишком много попыток. Подождите перед повторной отправкой или проверкой кода."};
  if (code==="team_consent_required") return {error:"Подтвердите согласие на обработку данных перед получением кода."};
  if (code==="team_policy_changed") return {error:"Условия обновились. Обновите страницу и подтвердите согласие ещё раз."};
  if (code==="team_code_invalid") return {error:"Код неверен или срок его действия истёк. Проверьте последнее письмо или запросите новый код."};
  if (code==="team_invitation_unavailable") return {error:"Приглашение недоступно. Снова откройте исходную ссылку. Если сбор завершён или ссылка заменена, обратитесь к владельцу компании."};
  return {error:"Не удалось выполнить вход. Попробуйте позже; если код уже получен, попробуйте ввести его."};
}
export async function sendTeamCodeAction(previous: TeamPasswordlessState,form: FormData): Promise<TeamPasswordlessState> {
  try {
    const {jar,hash}=await pendingInvitation();
    if (form.get("data_processing_consent")!=="on") throw new Error("team_consent_required");
    const policy=await registrationPolicy();
    for(const[k,v]of Object.entries(policy.versions)) if(form.get(`${k}_version`)!==v) throw new Error("team_policy_changed");
    const recipient=await target(hash);
    // Recipient is resolved from the valid invitation, never from a browser-supplied email.
    await enforceRateLimit(`team-code-cooldown:${hash}`,1,60);
    await enforceRateLimit(`team-code-send:${hash}`,5,3600);
    const mailbox=createHmac("sha256",authConfig().AUTH_FLOW_SECRET).update(recipient.email).digest("hex");
    await enforceRateLimit(`team-code-mailbox:${mailbox}`,5,3600);
    await enforceRateLimit("team-code-send:global",100,3600);
    const client=await createAuthClient();
    const {error}=await client.auth.signInWithOtp({email:recipient.email,options:{
      shouldCreateUser:recipient.create_user,emailRedirectTo:`${authConfig().APP_URL}/auth/confirm`,
      ...(recipient.create_user?{data:buildSignupMetadata({full_name:recipient.display_name,data_processing_consent:true,marketing_consent:false,versions:Object.fromEntries(Object.entries(policy.versions).map(([k,v])=>[`${k}_version`,v]))})}:{}),
    }});
    if(error) throw new Error(error.status===429?"rate_limited":"team_auth_unavailable");
    jar.set(challengeCookie,sealTeamChallenge(recipient.email,hash,authConfig().AUTH_FLOW_SECRET),{httpOnly:true,sameSite:"lax",secure:authConfig().secure,path:"/ru/team",maxAge:600});
    return {sent:true};
  } catch(error) {return {...failure(error),sent:previous.sent};}
}
export async function verifyTeamCodeAction(_: TeamPasswordlessState,form: FormData): Promise<TeamPasswordlessState> {
  try {
    const {jar,hash}=await pendingInvitation();
    const challenge=openTeamChallenge(jar.get(challengeCookie)?.value,hash,authConfig().AUTH_FLOW_SECRET);
    const code=String(form.get("code")??"").trim();
    if(!challenge || !/^[0-9]{6,10}$/.test(code)) throw new Error("team_code_invalid");
    const recipient=await target(hash);
    if(recipient.email!==challenge.email) throw new Error("team_invitation_unavailable");
    await enforceRateLimit(`team-code-verify:${hash}`,10,600);
    const client=await createAuthClient();
    const {data,error}=await client.auth.verifyOtp({email:challenge.email,token:code,type:"email"});
    if(error || !data.session || !data.user?.email_confirmed_at || data.user.email?.toLowerCase()!==challenge.email) throw new Error("team_code_invalid");
    await clearRecovery();
    // Clear the one-time challenge before accepting; if collection closes in the meantime,
    // the user stays signed in but receives no participant access from this proof alone.
    jar.set(challengeCookie,"",{httpOnly:true,sameSite:"lax",secure:authConfig().secure,path:"/ru/team",maxAge:0});
  } catch(error) {return failure(error);}
  // Preserve the usual role/assurance gate. No team-specific bypass for administrator sessions.
  await requireIdentity();
  let participant: string;
  try {
    const {jar,token}=await pendingInvitation();
    participant=await teamRpc<string>("accept_team_invitation",{p_token:token});
    jar.set(invitationCookie,"",{httpOnly:true,sameSite:"lax",secure:authConfig().secure,path:"/ru",maxAge:0});
  } catch(error) {return failure(error);}
  revalidatePath("/","layout");
  redirect(`/ru/team/responses/${participant}`);
}
