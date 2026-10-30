import { AuthShell } from "@/features/auth/auth-shell";
import { AuthForm } from "@/features/auth/auth-form";
import { ConfirmationRecovery } from "@/features/auth/confirmation-recovery";
import { confirmAction } from "@/server/auth/actions";
import { getIdentity } from "@/server/auth/session";
import { getMessages } from "@/i18n/messages";
export const metadata = { title: "Подтверждение действия", robots: { index: false, follow: false } };
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ type?: string; token_hash?: string; code?: string }> }) {
 const { type = "email", token_hash = "", code = "" } = await searchParams;
 console.info("[auth-confirm]", { checkpoint: "route_enter", has_code: Boolean(code), has_token_hash: Boolean(token_hash), type });
 const copy = getMessages("ru").auth;
 const validToken = /^[A-Za-z0-9_-]{32,256}$/.test(token_hash);
 const validCode = /^[A-Za-z0-9._~-]{20,512}$/.test(code);
 const valid = ["signup", "recovery", "email"].includes(type) && (validToken || validCode);
 const signedIn = type === "email" && Boolean((await getIdentity())?.user.email_confirmed_at);
 return <AuthShell title={type === "recovery" ? copy.forgotTitle : type === "email" ? "Вход по ссылке" : copy.verifyTitle}>{valid ? <AuthForm mode="confirm" action={confirmAction} signedIn={signedIn} hidden={{ type, ...(validCode ? { code } : { token_hash }) }} /> : <ConfirmationRecovery type={type} signedIn={signedIn} />}</AuthShell>;
}
