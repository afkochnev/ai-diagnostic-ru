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
  const title = "Управленческий AI-аудит компании";
  const description = "Пройдите диагностику системы управления и получите AI-отчёт с ключевыми рисками, ограничениями и планом действий на 90 дней.";
  const image = "https://audit.iteam.ru/og/iteam-audit.png";
  return { title: { default: title, template: `%s | ${title}` }, description, alternates: { canonical: "https://audit.iteam.ru" }, openGraph: { title, description, url: "https://audit.iteam.ru", type: "website", images: [{ url: image, width: 1200, height: 630, alt: title }] }, twitter: { card: "summary_large_image", title, description, images: [image] } };
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
      <footer className="border-t border-line py-7"><Container><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">{messages.site.footer}</p><a className="text-sm underline" href="https://iteam.ru" target="_blank" rel="noreferrer">iteam.ru</a></div></Container></footer>
    </>
  );
}
