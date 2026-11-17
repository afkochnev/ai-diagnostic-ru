import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "@/validation/auth";

const state = vi.hoisted(() => ({ current: {} as AuthState }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useActionState: () => [state.current, vi.fn(), false] }));
import { AuthForm } from "@/features/auth/auth-form";

const action = async () => ({});
const token = "synthetic-used-token";
const render = (type: string, signedIn = false, returnTo?: string) => renderToStaticMarkup(React.createElement(AuthForm, { mode: "confirm", action, hidden: { type, token_hash: token }, signedIn, returnTo }));

beforeEach(() => { state.current = { error: "Ссылка больше не действует", code: "invalid_link" }; });

describe("confirmation link recovery", () => {
  it("replaces the consumed token form with a fresh email request", () => {
    const html = render("email");
    expect(html).toContain('href="/ru/login?method=email"');
    expect(html).toContain("Запросить новое письмо");
    expect(html).not.toContain("<form");
    expect(html).not.toContain(token);
    expect(html).not.toContain("Подтвердить email");
  });
  it("offers the existing user's own protected workspace without claiming this link succeeded", () => {
    const html = render("email", true);
    expect(html).toContain('href="/ru/account"');
    expect(html).toContain("Открыть свой кабинет");
    expect(html).not.toContain("Email подтверждён");
    expect(html).not.toContain("/ru/login?method=email");
  });
  it("retains the questionnaire when requesting another email, including with a different session", () => {
    const path = "/ru/team/responses/10000000-0000-4000-8000-000000000001";
    for (const signedIn of [false, true]) {
      const html = render("email", signedIn, path);
      expect(html).toContain(`href="/ru/login?method=email&amp;next=${encodeURIComponent(path)}"`);
      expect(html).toContain("Продолжить анкету");
      expect(html).toContain("email, на который пришло приглашение");
      expect(html).not.toContain(token);
    }
  });
  it("ignores unsupported destinations and preserves the other confirmation flows", () => {
    expect(render("email", false, "https://external.test")).toContain('href="/ru/login?method=email"');
    expect(render("email", false, "/ru/team/join")).toContain('href="/ru/login?method=email&amp;next=team-invitation"');
    expect(render("signup", true, "/ru/team/join")).toContain('href="/ru/verify-email"');
    expect(render("recovery", true, "/ru/team/join")).toContain('href="/ru/forgot-password"');
  });
  it("keeps signup and password recovery on their own resend paths, even with a session", () => {
    expect(render("signup", true)).toContain('href="/ru/verify-email"');
    const html = render("recovery", true);
    expect(html).toContain('href="/ru/forgot-password"');
    expect(html).not.toContain("/ru/reset-password");
    expect(html).not.toContain("/ru/account");
  });
  it("retains confirmation for transient errors and calls ordinary email login by its name", () => {
    state.current = { error: "Сервис временно недоступен" };
    const html = render("email");
    expect(html).toContain("Сервис временно недоступен");
    expect(html).toContain("Войти в кабинет");
    expect(html).toContain(token);
    expect(html).toContain("<form");
  });
});
