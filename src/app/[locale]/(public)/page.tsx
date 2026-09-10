import { notFound, redirect } from "next/navigation";
import { LandingPage } from "@/features/landing/landing-page";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { getIdentity } from "@/server/auth/session";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (await getIdentity()) redirect("/ru/account");
  return <LandingPage locale={locale} messages={getMessages(locale)} />;
}
