import { notFound, redirect } from "next/navigation";
import { LandingPage } from "@/features/landing/landing-page";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { getIdentity } from "@/server/auth/session";

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const { locale } = await params;
  const { welcome } = await searchParams;
  if (!isLocale(locale)) notFound();
  if (await getIdentity() && welcome !== "1") redirect("/ru/account");
  return <LandingPage locale={locale} messages={getMessages(locale)} />;
}
