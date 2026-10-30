import Link from "next/link";
import { getMessages } from "@/i18n/messages";

export function ConfirmationRecovery({ type, signedIn = false }: { type: string; signedIn?: boolean }) {
  const copy = getMessages("ru").auth;
  const openAccount = type === "email" && signedIn;
  const href = openAccount ? "/ru/account" : type === "recovery" ? "/ru/forgot-password" : type === "signup" ? "/ru/verify-email" : "/ru/login?method=email";
  return <div className="space-y-5">
    <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{copy.invalidLink}</p>
    {openAccount && <p className="text-sm">В этом браузере вход уже выполнен. Вы можете открыть свой кабинет.</p>}
    <Link className="flex min-h-12 items-center justify-center rounded-xl bg-brand px-5 py-3 text-center font-semibold text-white hover:bg-brand-dark" href={href}>{openAccount ? "Открыть свой кабинет" : "Запросить новое письмо"}</Link>
  </div>;
}
