import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/features/auth/auth-shell";
import { AuthForm } from "@/features/auth/auth-form";
import { ForgotDialog } from "@/features/auth/forgot-dialog";
import { emailLoginAction, loginAction } from "@/server/auth/actions";
import { getIdentity } from "@/server/auth/session";
import { isAuthConfigured } from "@/server/supabase/config";
import { getMessages } from "@/i18n/messages";
import { safeTeamResponseReturnTo } from "@/server/auth/mfa-return";
import { authorizedTeamReturn } from "@/server/auth/team-login-return";
import { createAuthClient } from "@/server/supabase/server";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ password?: string; next?: string; method?: string }> }) {
  const { password, next, method } = await searchParams;
  const teamReturn = safeTeamResponseReturnTo(next);
  const identity = await getIdentity();
  if (identity) {
    if (next === "team-invitation") redirect("/ru/team/join");
    if (!teamReturn) redirect("/ru/account");
    const destination = await authorizedTeamReturn(teamReturn, await createAuthClient());
    if (destination) redirect(destination);
  }
  const copy = getMessages("ru").auth;

  const emailLink = method === "email";
  const continuation = next === "team-invitation" ? next : teamReturn;
  const nextQuery = continuation ? "&next=" + encodeURIComponent(continuation) : "";
  return <AuthShell title={copy.loginTitle}>{password === "updated" && <p role="status" className="mb-5">{copy.resetSuccess}</p>}{isAuthConfigured() ? <>
    <div className="mb-6 flex gap-2" aria-label="Способ входа"><Link aria-current={emailLink ? "page" : undefined} className={`rounded-xl border px-4 py-3 text-sm ${emailLink ? "border-brand bg-tint font-semibold" : "border-line"}`} href={`/ru/login?method=email${nextQuery}`}>По ссылке в email</Link><Link aria-current={!emailLink ? "page" : undefined} className={`rounded-xl border px-4 py-3 text-sm ${!emailLink ? "border-brand bg-tint font-semibold" : "border-line"}`} href={continuation ? `/ru/login?next=${encodeURIComponent(continuation)}` : "/ru/login"}>С паролем</Link></div>
    {emailLink && <p className="mb-5 text-sm text-muted">{continuation ? "Укажите email, на который пришло приглашение участника. После входа вернём вас к анкете." : "Укажите email, на который вы получили результаты диагностики. Отправим ссылку для входа без пароля."}</p>}
    <AuthForm key={emailLink ? "email" : "password"} mode={emailLink ? "email-login" : "login"} action={emailLink ? emailLoginAction : loginAction} hidden={continuation ? { next: continuation } : {}} />{!emailLink && <div className="mt-5"><ForgotDialog /></div>}
  </> : <p>{copy.unavailable}</p>}<Link href="/ru/register" className="mt-5 block text-sm underline">{copy.noAccount}</Link></AuthShell>;
}
