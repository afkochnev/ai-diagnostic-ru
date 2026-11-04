import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { LocaleProvider } from "@/i18n/context";
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
  const title = locale === "en" ? "AI Company Audit — Individual pilot" : "Управленческий AI-аудит компании";
  const description = getMessages(locale).landing.description;
  const origin = "https://audit.iteamsystems.com";
  const image = `${origin}/og/iteam-audit.png`;
  return { title: { default: title, template: `%s | ${title}` }, description, alternates: { canonical: `${origin}/${locale}` }, openGraph: { title, description, url: origin, type: "website", images: [{ url: image, width: 1200, height: 630, alt: title }] }, twitter: { card: "summary_large_image", title, description, images: [image] } };
}

export default async function LocaleLayout({ children, params }: Props & { children: ReactNode }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (locale === "en" && process.env.ENGLISH_PILOT_ENABLED !== "true") notFound();
  const messages = getMessages(locale);
  const path = (await headers()).get("x-audit-pathname") ?? "";
  const unsupported = locale === "en" && (/\/en\/(admin|team|free|billing)(\/|$)/.test(path) || /\/teams(\/|$)|\/team-explainer$|\/account\/plan$/.test(path));
  return (
    <LocaleProvider locale={locale}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-4">{messages.site.skip}</a>
      <SessionRefresh />
      <SiteHeader locale={locale} messages={messages} signedIn={Boolean(await getIdentity())} />
      {unsupported ? <main id="main-content" className="mx-auto min-h-[60vh] max-w-3xl px-5 py-16"><h1 className="text-3xl font-semibold">Individual pilot</h1><p className="mt-5">This English pilot includes the individual assessment, AI report and PDF. Team assessments and commercial packages will follow in a later iteration.</p><Link className="mt-6 inline-block underline" href="/en/companies">Return to your companies</Link></main> : children}
      <footer className="border-t border-line py-7"><Container><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">{messages.site.footer}</p><a className="text-sm underline" href="https://audit.iteamsystems.com" target="_blank" rel="noreferrer">audit.iteamsystems.com</a></div></Container></footer>
    </LocaleProvider>
  );
}
