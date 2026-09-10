import Link from "next/link";
import { AuthShell } from "@/features/auth/auth-shell";
import { AuthForm } from "@/features/auth/auth-form";
import { resendAction } from "@/server/auth/actions";
import { getMessages } from "@/i18n/messages";
export default function VerifyEmailPage() {
 const copy = getMessages("ru").auth;
 return <AuthShell title={copy.verifyTitle}><p className="mb-6 text-sm leading-relaxed">{copy.verifyText}</p><AuthForm mode="resend" action={resendAction} /><Link className="mt-5 block underline" href="/ru/login">{copy.loginLink}</Link></AuthShell>;
}
