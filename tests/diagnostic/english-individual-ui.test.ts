import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/i18n/context";
import { AnswerScale, AnswerScaleGuide } from "@/features/diagnostic/answer-scale";
import { QuestionnaireIntro } from "@/features/diagnostic/questionnaire-intro";
import { AIReportSection } from "@/features/ai/ai-report-section";
import { EnglishPilotLanding } from "@/features/landing/english-pilot-landing";
import { AuthForm } from "@/features/auth/auth-form";
import { localizedPath, pilotText } from "@/i18n/pilot-copy";
import type { Locale } from "@/i18n/config";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());
function render(locale: Locale, content: React.ReactNode) {
  return renderToStaticMarkup(React.createElement(LocaleProvider, { locale }, content));
}

describe("English Individual user interface", () => {
  it("preserves the original scale meaning and stored values in English", () => {
    const html = render("en", React.createElement(React.Fragment, {}, React.createElement(QuestionnaireIntro), React.createElement(AnswerScaleGuide), React.createElement(AnswerScale, { name: "practice", label: "Practice", value: 2, onChange() {} })));
    expect(html).toContain("about 20 minutes");
    expect(html).toContain("partly true");
    expect(html).toContain('aria-label="3 — partly true"');
    expect(html).toMatch(/checked="" value="2"/);
    expect(html).not.toMatch(/[А-Яа-яЁё]/);
    expect(render("ru", React.createElement(AnswerScaleGuide))).toContain("частично верно");
  });

  it("renders English report sections without changing respondent content", () => {
    const html = render("en", React.createElement(AIReportSection, { diagnosticId: "assessment", initial: { status: "completed", structured_content: { summary: "Client observation — 54.6", plan_30_days: "Agree one operating priority." } } }));
    expect(html).toContain("Executive summary");
    expect(html).toContain("30-day plan");
    expect(html).toContain("60-day plan");
    expect(html).toContain("90-day plan");
    expect(html).toContain("Client observation — 54.6");
    expect(pilotText("en", "Текст ответа клиента")).toBe("Текст ответа клиента");
  });

  it("provides a working demo entry without selling later pilot features", () => {
    const html = render("en", React.createElement(EnglishPilotLanding, { authenticated: false }));
    expect(html).toContain('href="/en/register"');
    expect(html).toContain("Individual assessment");
    expect(html).toContain("being prepared separately");
    expect(html).not.toContain("480");
    expect(html).not.toContain("/ru/account/plan");
  });

  it("submits English auth context and clearly identifies the current legal language", () => {
    const html = render("en", React.createElement(AuthForm, { mode: "register", action: async () => ({}), policy: { versions: { data_processing: "original-version" }, temporary: false, dataUrl: "/en/legal/privacy/original-version", marketingUrl: "/en/legal/privacy/marketing-original" } }));
    expect(html).toContain('name="locale" value="en"');
    expect(html).toContain("published legal documents are in Russian");
    expect(html).toContain('name="data_processing_version" value="original-version"');
    expect(html).toContain('href="/en/legal/privacy/original-version"');
    expect(localizedPath("en", "/ru/login?method=email")).toBe("/en/login?method=email");
  });
});
