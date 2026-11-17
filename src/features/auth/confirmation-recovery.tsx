import Link from "next/link";
import { getMessages } from "@/i18n/messages";
import { safeTeamResponseReturnTo } from "@/server/auth/mfa-return";

export function ConfirmationRecovery({ type, signedIn = false, returnTo }: { type: string; signedIn?: boolean; returnTo?: string | null }) {
  const copy = getMessages("ru").auth;
  const continuation = type === "email" ? returnTo === "/ru/team/join" ? "team-invitation" : safeTeamResponseReturnTo(returnTo) : null;
  const openAccount = type === "email" && signedIn && !continuation;
  const href = continuation ? `/ru/login?method=email&next=${encodeURIComponent(continuation)}` : openAccount ? "/ru/account" : type === "recovery" ? "/ru/forgot-password" : type === "signup" ? "/ru/verify-email" : "/ru/login?method=email";
  return <div className="space-y-5">
    <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{copy.invalidLink}</p>
    {openAccount && <p className="text-sm">В этом браузере вход уже выполнен. Вы можете открыть свой кабинет.</p>}
    {continuation && <p className="text-sm">Для продолжения анкеты войдите с email, на который пришло приглашение. Сохранённые ответы будут доступны после входа.</p>}
    <Link className="flex min-h-12 items-center justify-center rounded-xl bg-brand px-5 py-3 text-center font-semibold text-white hover:bg-brand-dark" href={href}>{continuation ? "Продолжить анкету" : openAccount ? "Открыть свой кабинет" : "Запросить новое письмо"}</Link>
  </div>;
}
