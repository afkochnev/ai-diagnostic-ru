import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/features/auth/auth-shell";
import { AuthForm } from "@/features/auth/auth-form";
import { ForgotDialog } from "@/features/auth/forgot-dialog";
import { loginAction } from "@/server/auth/actions";
import { getIdentity } from "@/server/auth/session";
import { isAuthConfigured } from "@/server/supabase/config";
import { getMessages } from "@/i18n/messages";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ password?: string }> }) {
  if (await getIdentity()) redirect("/ru/account");
  const copy = getMessages("ru").auth;
  const { password } = await searchParams;
  return <AuthShell title={copy.loginTitle}>{password === "updated" && <p role="status" className="mb-5">{copy.resetSuccess}</p>}{isAuthConfigured() ? <><AuthForm mode="login" action={loginAction} /><div className="mt-5"><ForgotDialog /></div></> : <p>{copy.unavailable}</p>}<Link href="/ru/register" className="mt-5 block text-sm underline">{copy.noAccount}</Link></AuthShell>;
}
