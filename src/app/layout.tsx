import type { ReactNode } from "react";
import { requestLocale } from "@/server/locale";
import { LocaleProvider } from "@/i18n/context";
import "./globals.css";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await requestLocale();
  return <html lang={locale}><body><LocaleProvider locale={locale}>{children}</LocaleProvider></body></html>;
}
