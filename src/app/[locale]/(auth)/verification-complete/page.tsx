export const metadata = { robots: { index: false, follow: false } };

import { pilotText as tr, localizedPath } from "@/i18n/pilot-copy";
import { requestLocale } from "@/server/locale";
import Link from "next/link";
import { AuthShell } from "@/features/auth/auth-shell";
import { requireIdentity, signedInDestination } from "@/server/auth/session";
export default async function VerificationCompletePage() {
  const locale = await requestLocale();

  await requireIdentity();
  const destination = await signedInDestination();
  return <AuthShell title={tr(locale, "Email подтверждён")}><p role="status">{tr(locale, "Вы вошли в приложение. Можно продолжить диагностику — возвращаться к регистрации не потребуется.")}</p><Link className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand px-5 py-3 font-semibold text-white" href={destination}>{destination === localizedPath(locale, "/ru/company-profile") ? tr(locale, "Рассказать о компании и начать") : tr(locale, "Продолжить работу")}</Link></AuthShell>;
}
