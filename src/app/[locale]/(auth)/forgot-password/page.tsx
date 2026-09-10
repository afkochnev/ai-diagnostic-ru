import { AuthShell } from "@/features/auth/auth-shell";
import { AuthForm } from "@/features/auth/auth-form";
import { forgotAction } from "@/server/auth/actions";
import { getMessages } from "@/i18n/messages";
export default function ForgotPasswordPage() { return <AuthShell title={getMessages("ru").auth.forgotTitle}><AuthForm mode="forgot" action={forgotAction} /></AuthShell>; }
