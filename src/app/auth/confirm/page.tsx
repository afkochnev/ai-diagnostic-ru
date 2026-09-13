import Link from "next/link";
import { AuthShell } from "@/features/auth/auth-shell";
import { AuthForm } from "@/features/auth/auth-form";
import { confirmAction } from "@/server/auth/actions";
import { getMessages } from "@/i18n/messages";
export const metadata = { title: "Подтверждение действия", robots: { index: false, follow: false } };
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ type?: string; token_hash?: string; code?: string }> }) {
 const { type = "", token_hash = "", code = "" } = await searchParams;
 console.info("[auth-confirm]", { checkpoint: "route_enter", has_code: Boolean(code) });
 const copy = getMessages("ru").auth;
 const validToken = /^[A-Za-z0-9_-]{32,256}$/.test(token_hash);
 const validCode = /^[A-Za-z0-9._~-]{20,512}$/.test(code);
 const valid = ["signup", "recovery"].includes(type) && (validToken || validCode);
 return <AuthShell title={type === "recovery" ? copy.forgotTitle : copy.verifyTitle}>{valid ? <><p className="mb-5">{copy.confirmText}</p><AuthForm mode="confirm" action={confirmAction} hidden={{ type, ...(validCode ? { code } : { token_hash }) }} /></> : <><p role="alert">{copy.invalidLink}</p><Link className="mt-5 block underline" href="/ru/login">{copy.loginLink}</Link></>}</AuthShell>;
}
