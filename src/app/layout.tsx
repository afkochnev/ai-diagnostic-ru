import type { ReactNode } from "react";
import { defaultLocale } from "@/i18n/config";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  // Only Russian is enabled. Move the document shell into the locale layout
  // when another locale is enabled so the document language follows its route.
  return <html lang={defaultLocale}><body>{children}</body></html>;
}
