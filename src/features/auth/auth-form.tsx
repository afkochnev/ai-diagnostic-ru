"use client";

import { useActionState, useState, type FormEvent } from "react";
import Link from "next/link";
import { emailSchema, loginSchema, passwordSchema, registrationSchema, type AuthState } from "@/validation/auth";
import { getMessages } from "@/i18n/messages";

type Mode = "register" | "login" | "forgot" | "resend" | "reset" | "confirm" | "mfa";
type Policy = { versions: Record<string, string>; temporary: boolean; dataUrl: string; marketingUrl: string };
type Props = { action: (state: AuthState, form: FormData) => Promise<AuthState>; mode: Mode; policy?: Policy; hidden?: Record<string, string> };
const copy = getMessages("ru").auth;
const inputClass = "mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-3 py-3 text-base text-brand";

export function AuthForm({ action, mode, policy, hidden = {} }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [localError, setLocalError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const hasEmail = ["register", "login", "forgot", "resend"].includes(mode);
  const hasPassword = ["register", "login", "reset"].includes(mode);
  const labels: Record<Mode, string> = { register: copy.register, login: copy.login, forgot: copy.sendReset, resend: copy.resend, reset: copy.savePassword, confirm: hidden.type === "recovery" ? copy.confirmRecovery : copy.confirm, mfa: copy.mfaVerify };

  function validate(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    let error = "";
    if (hasEmail && !emailSchema.safeParse(email).success) error = copy.badEmail;
    else if (["register", "reset"].includes(mode) && !passwordSchema.safeParse(password).success) error = copy.badPassword;
    else if (mode === "login" && !loginSchema.safeParse({ email, password }).success) error = copy.emptyLogin;
    else if (mode === "register") {
      const result = registrationSchema.safeParse({ email, password, confirm_password: form.get("confirm_password"), full_name: form.get("full_name"), data_processing_consent: form.get("data_processing_consent") === "on", marketing_consent: form.get("marketing_consent") === "on" });
      if (!result.success) error = result.error.issues.some((issue) => issue.path[0] === "confirm_password") ? copy.passwordMismatch : copy.required;
    }
    if (error) event.preventDefault();
    setLocalError(error);
  }

  return (
    <form action={formAction} onSubmit={validate} noValidate className="space-y-5">
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {policy && Object.entries(policy.versions).map(([kind, version]) => <input key={kind} type="hidden" name={`${kind}_version`} value={version} />)}
      {mode === "register" && <label className="block text-sm font-medium">{copy.name}<input className={inputClass} name="full_name" autoComplete="name" required maxLength={200} /></label>}
      {hasEmail && <label className="block text-sm font-medium">{copy.email}<input className={inputClass} name="email" type="email" autoComplete="email" required maxLength={254} /></label>}
      {hasPassword && <label className="block text-sm font-medium">{mode === "reset" ? copy.newPassword : copy.password}<span className="relative mt-2 block"><input className={`${inputClass} pr-24`} name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 8} maxLength={1024} aria-describedby={mode !== "login" ? "password-hint" : undefined} /><button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-2 text-sm underline" onClick={() => setShowPassword((value) => !value)}>{showPassword ? copy.hidePassword : copy.showPassword}</button></span>{mode !== "login" && <span id="password-hint" className="mt-2 block text-xs text-muted">{copy.passwordHint}</span>}</label>}
      {mode === "register" && <label className="block text-sm font-medium">{copy.confirmPassword}<span className="relative mt-2 block"><input className={`${inputClass} pr-24`} name="confirm_password" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={1024} /><button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-2 text-sm underline" onClick={() => setShowPassword((value) => !value)}>{showPassword ? copy.hidePassword : copy.showPassword}</button></span></label>}
      {mode === "mfa" && <label className="block text-sm font-medium">{copy.mfaCode}<input className={inputClass} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>}
      {mode === "register" && policy && <>
        <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" name="data_processing_consent" required className="mt-1 h-5 w-5 shrink-0 accent-brand" /><span>{copy.dataConsent}</span></label>
        <Link className="block text-sm underline" href={policy.dataUrl}>{copy.dataLink}</Link>
        <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" name="marketing_consent" className="mt-1 h-5 w-5 shrink-0 accent-brand" /><span>{copy.marketingConsent}</span></label>
        <Link className="block text-sm underline" href={policy.marketingUrl}>{copy.marketingLink}</Link>
        {policy.temporary && <p className="text-xs leading-relaxed text-muted">{copy.temporaryLegal}</p>}
      </>}
      {(localError || state.error) && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{localError || state.error}</p>}
      {state.success && <p role="status" className="rounded-xl bg-tint p-3 text-sm">{state.success}</p>}
      <button disabled={pending} className="min-h-12 w-full cursor-pointer rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:cursor-wait disabled:opacity-60">{pending ? copy.pending : labels[mode]}</button>
    </form>
  );
}
