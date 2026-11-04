import "server-only";
import { cookies, headers } from "next/headers";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";

/** Locale is presentation context only and never grants access. */
export function formLocale(form?: FormData): Locale {
  const locale = form?.get("locale");
  return isLocale(typeof locale === "string" ? locale : "") ? locale as Locale : defaultLocale;
}

export async function requestLocale(): Promise<Locale> {
  // The proxy overwrites this header from the actual route, including callbacks.
  const locale = (await headers()).get("x-audit-locale");
  if (locale && isLocale(locale)) return locale;
  const remembered = (await cookies()).get("audit-locale")?.value;
  return remembered && isLocale(remembered) ? remembered : defaultLocale;
}

export async function rememberLocale(locale: Locale) {
  (await cookies()).set("audit-locale", locale, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}
