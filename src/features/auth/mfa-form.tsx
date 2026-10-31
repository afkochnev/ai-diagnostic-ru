"use client";

import { useActionState } from "react";
import { enrollMfaAction, verifyMfaAction } from "@/server/auth/actions";
import { getMessages } from "@/i18n/messages";
import { AuthForm } from "./auth-form";
import type { AuthState } from "@/validation/auth";

export function MfaForm({ factorId, returnTo }: { factorId?: string; returnTo?: string }) {
  const [state, action, pending] = useActionState<AuthState>(enrollMfaAction, {});
  const copy = getMessages("ru").auth;
  const activeFactor = factorId || state.factorId;
  return <div className="space-y-5">
    {returnTo && <p className="rounded-xl bg-tint p-4 text-sm leading-relaxed">{factorId ? "В вашем аккаунте уже настроена двухфакторная защита. " : ""}После подтверждения вернём вас к подключению Advanced. Промокод не меняет настройки защиты аккаунта.</p>}
    <p className="text-sm leading-relaxed">{copy.mfaText}</p>
    {!activeFactor && <form action={action}><button className="min-h-12 w-full rounded-xl bg-brand px-5 py-3 text-white" disabled={pending}>{pending ? copy.pending : copy.mfaEnroll}</button></form>}
    {state.secret && <div className="rounded-xl bg-tint p-4"><p className="text-sm">{copy.mfaSecret}</p><code className="mt-3 block break-all" data-mfa-secret>{state.secret}</code></div>}
    {state.error && <p role="alert">{state.error}</p>}
    {activeFactor && <AuthForm mode="mfa" action={verifyMfaAction} hidden={{ factor_id: activeFactor, ...(returnTo ? {next: returnTo} : {}) }} />}
  </div>;
}
