export const metadata = { title: "Email подтверждён", robots: { index: false, follow: false } };

import Link from "next/link";
import { AuthShell } from "@/features/auth/auth-shell";
import { requireIdentity, signedInDestination } from "@/server/auth/session";
export default async function VerificationCompletePage() {
  await requireIdentity();
  const destination = await signedInDestination();
  return <AuthShell title="Email подтверждён"><p role="status">Вы вошли в приложение. Можно продолжить диагностику — возвращаться к регистрации не потребуется.</p><Link className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand px-5 py-3 font-semibold text-white" href={destination}>{destination === "/ru/company-profile" ? "Рассказать о компании и начать" : "Продолжить работу"}</Link></AuthShell>;
}
