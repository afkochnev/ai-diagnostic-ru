import Link from "next/link";
import { AuthShell } from "@/features/auth/auth-shell";
import { AuthForm } from "@/features/auth/auth-form";
import { resetAction } from "@/server/auth/actions";
import { hasRecovery } from "@/server/auth/recovery";
import { createAuthClient } from "@/server/supabase/server";
import { getMessages } from "@/i18n/messages";
export default async function ResetPasswordPage() {
 const copy = getMessages("ru").auth;
 const client = await createAuthClient();
 const { data: { user } } = await client.auth.getUser();
 const { data } = await client.auth.getClaims();
 const sessionId = data?.claims.session_id;
 const valid = user && typeof sessionId === "string" && await hasRecovery(user.id, sessionId);
 return <AuthShell title={copy.resetTitle}>{valid ? <AuthForm mode="reset" action={resetAction} /> : <><p role="alert">{copy.invalidLink}</p><Link className="mt-5 block underline" href="/ru/forgot-password">{copy.forgotTitle}</Link></>}</AuthShell>;
}
