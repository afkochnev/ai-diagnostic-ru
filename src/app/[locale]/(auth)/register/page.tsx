import { localizedPath } from "@/i18n/pilot-copy";
import { requestLocale } from "@/server/locale";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/features/auth/auth-shell";
import { AuthForm } from "@/features/auth/auth-form";
import { registerAction } from "@/server/auth/actions";
import { registrationPolicy } from "@/server/auth/legal";
import { getIdentity } from "@/server/auth/session";
import { isAuthConfigured } from "@/server/supabase/config";
import { getMessages } from "@/i18n/messages";
export const metadata = { robots: { index: false } };
export default async function RegisterPage() {
  const locale = await requestLocale();

  if (await getIdentity()) redirect(localizedPath(locale, "/ru/account"));
  const copy = getMessages(locale).auth;
  return <AuthShell title={copy.registerTitle}>{isAuthConfigured() ? <AuthForm mode="register" action={registerAction} policy={await registrationPolicy(locale)} /> : <p>{copy.unavailable}</p>}<Link href={localizedPath(locale, "/ru/login")} className="mt-6 block text-sm underline">{copy.hasAccount}</Link></AuthShell>;
}
