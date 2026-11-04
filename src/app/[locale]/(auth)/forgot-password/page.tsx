
import { requestLocale } from "@/server/locale";
import { AuthShell } from "@/features/auth/auth-shell";
import { AuthForm } from "@/features/auth/auth-form";
import { forgotAction } from "@/server/auth/actions";
import { getMessages } from "@/i18n/messages";
export default async function ForgotPasswordPage() {
  const locale = await requestLocale();
 return <AuthShell title={getMessages(locale).auth.forgotTitle}><AuthForm mode="forgot" action={forgotAction} /></AuthShell>; }
