import { notFound } from "next/navigation";
import { LandingPage } from "@/features/landing/landing-page";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { getIdentity } from "@/server/auth/session";

export default async function Page({ params }: { params: Promise<{ locale: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const identity = await getIdentity();
  return <LandingPage locale={locale} messages={getMessages(locale)} authenticated={Boolean(identity)} />;
}
