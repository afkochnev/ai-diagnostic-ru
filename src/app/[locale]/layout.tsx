import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/container";
import { SiteHeader } from "@/features/landing/site-header";
import { isLocale, locales } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { getIdentity } from "@/server/auth/session";
import { SessionRefresh } from "@/features/auth/session-refresh";

type Props = { params: Promise<{ locale: string }> };

export function generateStaticParams() { return locales.map((locale) => ({ locale })); }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = getMessages(locale);
  return { title: { default: messages.site.name, template: `%s | ${messages.site.name}` }, description: messages.landing.description };
}

export default async function LocaleLayout({ children, params }: Props & { children: ReactNode }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = getMessages(locale);
  return (
    <>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-4">{messages.site.skip}</a>
      <SessionRefresh />
      <SiteHeader locale={locale} messages={messages} signedIn={Boolean(await getIdentity())} />
      {children}
      <footer className="border-t border-line py-7"><Container><p className="text-sm text-muted">{messages.site.footer}</p></Container></footer>
    </>
  );
}
