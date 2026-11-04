import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "@/i18n/config";

const request = vi.hoisted(() => ({ locale: "ru" as "ru" | "en" }));
vi.mock("@/server/locale", () => ({ requestLocale: async () => request.locale }));

import RootLayout from "@/app/layout";
import NotFound from "@/app/not-found";
import ErrorPage from "@/app/error";

beforeEach(() => { request.locale = "ru"; vi.stubGlobal("React", React); });
afterEach(() => vi.unstubAllGlobals());

describe("error pages preserve the request language", () => {
  it.each([
    ["en", "Page not found", "Home"],
    ["ru", "Страница не найдена", "На главную"],
  ] as const)("returns a %s 404 and matching home link", async (locale, title, link) => {
    request.locale = locale;
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain(title);
    expect(html).toContain(`href="/${locale}"`);
    expect(html).toContain(link);
  });

  it.each([
    ["en", "We could not open this page", "Try again"],
    ["ru", "Не удалось открыть страницу", "Попробовать ещё раз"],
  ] as const)("root error boundary inherits %s without a locale layout", async (locale: Locale, title, retry) => {
    request.locale = locale;
    const tree = await RootLayout({ children: React.createElement(ErrorPage, { error: new Error("Private provider failure"), reset() {} }) });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain(title);
    expect(html).toContain(retry);
    expect(html).not.toContain("Private provider failure");
  });
});
