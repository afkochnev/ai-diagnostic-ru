"use server";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/server/auth/session";
import { clearRecovery } from "@/server/auth/recovery";
import { createAuthClient } from "@/server/supabase/server";
import { authConfig } from "@/server/supabase/config";
import { requireCompanyWrite } from "@/server/account/authorization";
import { getTeamInvitationProvider, teamInvitationMessage } from "./invitation-email";
import { sealInvitationDetails,openInvitationDetails } from "./invitation-details";
import { enforceRateLimit } from "@/server/rate-limit";
import { invitationToken, teamCreation, teamInvitation, teamSave, type TeamActionState } from "./contracts";
import { sealInvitation } from "./invitation-envelope";
import { invitationCompany, ownerTeam, teamRpc } from "./service";
import { teamFoundationEnabled } from "./capabilities";
import { sendTeamCodeAction } from "./passwordless-actions";
import { z } from "zod";
const cookieName = "team-invitation";
const value = (form: FormData, key: string) => String(form.get(key) ?? "");
async function origin() {
  if (!teamFoundationEnabled() || (await headers()).get("origin") !== authConfig().APP_URL) throw new Error("team_unavailable");
}
function failure(error: unknown): TeamActionState {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    team_already_invited: "Этот участник уже приглашён. При необходимости выпустите новую ссылку.",
    team_revision_conflict: "Ответы изменились в другой вкладке. Обновите страницу перед сохранением.",
    team_response_completed: "Ответы уже отправлены.",
    team_required_answers_missing: "Ответьте на все обязательные вопросы перед отправкой.",
    team_participant_limit: "В этой диагностике уже 100 приглашённых участников.",
    team_invitation_unavailable: "Не удалось принять приглашение. Проверьте email текущего аккаунта: он должен совпадать с адресом, на который вас пригласили. Ссылка также может быть заменена, просрочена или недоступна после завершения сбора ответов.",
    team_closed: "Сбор ответов завершён. Новые приглашения и отправка ответов недоступны.",
    team_switch_account_failed: "Не удалось выйти из текущего аккаунта. Попробуйте ещё раз.",
    rate_limited: "Слишком много запросов. Попробуйте позже.",
  };
  return { error: messages[code] ?? "Не удалось выполнить действие. Проверьте данные и доступ к приглашению." };
}
export async function createTeamAction(_: TeamActionState, form: FormData): Promise<TeamActionState> {
  let id: string;
  let companyId: string;
  try {
    await origin(); const identity = await requireIdentity();
    const input = teamCreation.parse({ companyId: value(form,"companyId"), title: value(form,"title") });
    companyId = input.companyId;
    await requireCompanyWrite(companyId, identity.user.id);
    await enforceRateLimit(`team-create:${identity.user.id}`, 20, 86400);
    id = await teamRpc<string>("create_team_diagnostic", { p_company_id: companyId, p_title: input.title });
  } catch (error) { return failure(error); }
  revalidatePath(`/ru/companies/${companyId}/teams`);
  redirect(`/ru/companies/${companyId}/teams/${id}`);
}
export async function inviteTeamAction(_: TeamActionState, form: FormData): Promise<TeamActionState> {
  try {
    await origin(); const identity = await requireIdentity();
    const input = teamInvitation.parse({ teamId: value(form,"teamId"), email: value(form,"email"), displayName: value(form,"displayName") });
    const record = await ownerTeam(input.teamId);
    if (!record) throw new Error("team_not_found");
    await requireCompanyWrite(record.team.company_id, identity.user.id);
    const company=await invitationCompany(record.team.company_id);
    await enforceRateLimit(`team-invite:${identity.user.id}`, 100, 86400);
    const token = randomBytes(32).toString("hex"), hash = createHash("sha256").update(token).digest("hex");
    const participantId = await teamRpc<string>("invite_team_participant", { p_team_id: input.teamId, p_email: input.email, p_display_name: input.displayName, p_token_hash: hash });
    const result = await deliverInvitation(participantId, input.email, record.team.title, token, hash,company,identity.user.user_metadata?.full_name ?? "Организатор");
    revalidatePath(`/ru/companies/${record.team.company_id}/teams/${input.teamId}`);
    return result;
  } catch (error) { return failure(error); }
}
async function deliverInvitation(participantId: string, email: string, title: string, token: string, hash: string,company:string,inviter:string): Promise<TeamActionState> {
  const details=sealInvitationDetails({email,company:company.slice(0,200),team:title,inviter:String(inviter).slice(0,100),invitationHash:hash},authConfig().AUTH_FLOW_SECRET);
  const invitationUrl = `${authConfig().APP_URL}/ru/team/join#invitation=${token}&context=${details}`;
  let emailStatus: TeamActionState["emailStatus"] = "failed";
  try {
    const provider = getTeamInvitationProvider();
    const receipt=await provider.send({ to: email,...teamInvitationMessage({company,team:title,inviter,url:invitationUrl}), idempotencyKey: `team-invitation/${participantId}/${hash}` });
    emailStatus = provider.name === "mock" ? "mock" : "sent";
    console.info("[team-email]",{event:"invitation_delivery",provider:provider.name,providerAccepted:true,providerMessageId:receipt.providerMessageId,correlation:hash.slice(0,12)});
    return {emailStatus,recipient:email,participantId,provider:provider.name,providerMessageId:receipt.providerMessageId,...(emailStatus==="mock"?{invitationUrl}:{})};
  } catch { /* Keep link available and explicitly report email delivery failure. */ }
  console.info("[team-email]",{event:"invitation_delivery",providerAccepted:false,correlation:hash.slice(0,12)});
  return { invitationUrl, emailStatus,recipient:email,participantId };
}
export async function renewTeamInvitationAction(_: TeamActionState, form: FormData): Promise<TeamActionState> {
  try {
    await origin(); const identity = await requireIdentity();
    const participantId = z.uuid().parse(value(form,"participantId")), teamId = z.uuid().parse(value(form,"teamId"));
    const record = await ownerTeam(teamId), participant = record?.participants.find((p) => p.id === participantId);
    if (!record || !participant) throw new Error("team_not_found");
    await requireCompanyWrite(record.team.company_id,identity.user.id);
    const company=await invitationCompany(record.team.company_id);
    await enforceRateLimit(`team-invite:${identity.user.id}`, 100, 86400);
    const token = randomBytes(32).toString("hex"), hash = createHash("sha256").update(token).digest("hex");
    await teamRpc<null>("renew_team_invitation", { p_participant_id: participantId, p_token_hash: hash });
    return await deliverInvitation(participantId, participant.email, record.team.title, token, hash,company,identity.user.user_metadata?.full_name ?? "Организатор");
  } catch (error) { return failure(error); }
}
export async function revokeTeamAction(form: FormData) {
  await origin(); await requireIdentity();
  const id = z.uuid().parse(value(form,"participantId"));
  await teamRpc<null>("revoke_team_participant", { p_participant_id: id });
  const teamId = z.uuid().parse(value(form,"teamId")), companyId = z.uuid().parse(value(form,"companyId"));
  revalidatePath(`/ru/companies/${companyId}/teams/${teamId}`);
}
export async function prepareTeamInvitationAction(_: TeamActionState, form: FormData): Promise<TeamActionState> {
  try {
    await origin();
    const token = invitationToken.parse(value(form,"token"));
    const details=value(form,"context"),hash=createHash("sha256").update(token).digest("hex");
    if(details && !openInvitationDetails(details,hash,authConfig().AUTH_FLOW_SECRET))throw new Error("team_invitation_unavailable");
    (await cookies()).set(cookieName, sealInvitation(token, authConfig().AUTH_FLOW_SECRET), { httpOnly: true, sameSite: "lax", secure: authConfig().secure, path: "/ru", maxAge: 1800 });
    (await cookies()).set("team-invitation-details",details,{httpOnly:true,sameSite:"lax",secure:authConfig().secure,path:"/ru",maxAge:1800});
    (await cookies()).set("team-email-challenge","",{httpOnly:true,sameSite:"lax",secure:authConfig().secure,path:"/ru/team",maxAge:0});
    return { status: "prepared" };
  } catch (error) { return failure(error); }
}
export async function acceptTeamInvitationAction(_:TeamActionState,form:FormData): Promise<TeamActionState> { return sendTeamCodeAction({},form); }
export async function switchTeamInvitationAccountAction(): Promise<TeamActionState> {
  try {
    await origin();
    const client = await createAuthClient();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new Error("team_switch_account_failed");
    await clearRecovery();
    // Preserve the encrypted pending invitation while replacing only this login.
  } catch (error) { return failure(error); }
  revalidatePath("/", "layout");
  redirect("/ru/team/join");
}
export async function saveTeamResponseAction(previous: TeamActionState, form: FormData): Promise<TeamActionState> {
  try {
    await origin(); const identity = await requireIdentity();
    await enforceRateLimit(`team-save:${identity.user.id}`, 120, 3600);
    const raw = value(form,"answers");
    if (raw.length > 1000000) throw new Error("team_invalid_answers");
    const input = teamSave.parse({ participantId: value(form,"participantId"), revision: value(form,"revision"), answers: JSON.parse(raw), submit: value(form,"intent") === "submit" });
    return await teamRpc<{ revision: number; status: string }>("save_team_response", { p_participant_id: input.participantId, p_expected_revision: input.revision, p_answers: input.answers, p_submit: input.submit });
  } catch (error) { return { revision: previous.revision, status: previous.status, ...failure(error) }; }
}

export async function teamResultAction(_: TeamActionState, form: FormData): Promise<TeamActionState> {
  try {
    await origin(); const identity = await requireIdentity();
    const teamId = z.uuid().parse(value(form,"teamId"));
    const record = await ownerTeam(teamId);
    if (!record) throw new Error("team_not_found");
    await requireCompanyWrite(record.team.company_id, identity.user.id);
    await enforceRateLimit(`team-results:${identity.user.id}`,60,3600);
    const intent = z.enum(["refresh","report","close"]).parse(value(form,"intent"));
    await teamRpc(intent === "report" ? "request_team_report" : intent === "close" ? "close_team_diagnostic" : "refresh_team_results", { p_team_id: teamId });
    revalidatePath(`/ru/companies/${record.team.company_id}/teams/${teamId}`);
    return { status: intent === "close" ? "closed" : "requested" };
  } catch (error) { return failure(error); }
}
