import { localizedPath } from "@/i18n/pilot-copy";
import { requestLocale } from "@/server/locale";
import Link from "next/link";
import { AuthShell } from "@/features/auth/auth-shell";
import { AuthForm } from "@/features/auth/auth-form";
import { resendAction } from "@/server/auth/actions";
import { getMessages } from "@/i18n/messages";
export default async function VerifyEmailPage() {
  const locale = await requestLocale();

 const copy = getMessages(locale).auth;
 return <AuthShell title={copy.verifyTitle}><p className="mb-6 text-sm leading-relaxed">{copy.verifyText}</p><AuthForm mode="resend" action={resendAction} /><Link className="mt-5 block underline" href={localizedPath(locale, "/ru/login")}>{copy.loginLink}</Link></AuthShell>;
}
