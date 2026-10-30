import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/features/auth/auth-shell";
import { AuthForm } from "@/features/auth/auth-form";
import { ForgotDialog } from "@/features/auth/forgot-dialog";
import { emailLoginAction, loginAction } from "@/server/auth/actions";
import { getIdentity } from "@/server/auth/session";
import { isAuthConfigured } from "@/server/supabase/config";
import { getMessages } from "@/i18n/messages";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ password?: string; next?: string; method?: string }> }) {
  const { password, next, method } = await searchParams;
  if (await getIdentity()) redirect(next === "team-invitation" ? "/ru/team/join" : "/ru/account");
  const copy = getMessages("ru").auth;

  const emailLink = method === "email" && next !== "team-invitation";
  return <AuthShell title={copy.loginTitle}>{password === "updated" && <p role="status" className="mb-5">{copy.resetSuccess}</p>}{isAuthConfigured() ? <>
    {next !== "team-invitation" && <div className="mb-6 flex gap-2" aria-label="Способ входа"><Link aria-current={emailLink ? "page" : undefined} className={`rounded-xl border px-4 py-3 text-sm ${emailLink ? "border-brand bg-tint font-semibold" : "border-line"}`} href="/ru/login?method=email">По ссылке в email</Link><Link aria-current={!emailLink ? "page" : undefined} className={`rounded-xl border px-4 py-3 text-sm ${!emailLink ? "border-brand bg-tint font-semibold" : "border-line"}`} href="/ru/login">С паролем</Link></div>}
    {emailLink && <p className="mb-5 text-sm text-muted">Укажите email, на который вы получили результаты диагностики. Отправим ссылку для входа без пароля.</p>}
    <AuthForm key={emailLink ? "email" : "password"} mode={emailLink ? "email-login" : "login"} action={emailLink ? emailLoginAction : loginAction} hidden={next === "team-invitation" ? { next } : {}} />{!emailLink && <div className="mt-5"><ForgotDialog /></div>}
  </> : <p>{copy.unavailable}</p>}<Link href="/ru/register" className="mt-5 block text-sm underline">{copy.noAccount}</Link></AuthShell>;
}
