"use client";
import { pilotText as tr, localizedPath } from "@/i18n/pilot-copy";
import { useLocale } from "@/i18n/context";
import Link from "next/link";
import { getMessages } from "@/i18n/messages";

export function ConfirmationRecovery({ type, signedIn = false }: { type: string; signedIn?: boolean }) {
  const locale = useLocale();

  const copy = getMessages(locale).auth;
  const openAccount = type === "email" && signedIn;
  const href = openAccount ? localizedPath(locale, "/ru/account") : type === "recovery" ? localizedPath(locale, "/ru/forgot-password") : type === "signup" ? localizedPath(locale, "/ru/verify-email") : localizedPath(locale, "/ru/login?method=email");
  return <div className="space-y-5">
    <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{copy.invalidLink}</p>
    {openAccount && <p className="text-sm">{tr(locale, "В этом браузере вход уже выполнен. Вы можете открыть свой кабинет.")}</p>}
    <Link className="flex min-h-12 items-center justify-center rounded-xl bg-brand px-5 py-3 text-center font-semibold text-white hover:bg-brand-dark" href={href}>{openAccount ? tr(locale, "Открыть свой кабинет") : tr(locale, "Запросить новое письмо")}</Link>
  </div>;
}
