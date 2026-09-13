import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const action = readFileSync("src/server/auth/actions.ts", "utf8");
const confirm = readFileSync("src/app/auth/confirm/page.tsx", "utf8");
const landing = readFileSync("src/app/[locale]/(public)/page.tsx", "utf8");
const landingView = readFileSync("src/features/landing/landing-page.tsx", "utf8");
const form = readFileSync("src/features/auth/auth-form.tsx", "utf8");

describe("staging auth flow contract", () => {
  it("supports both Supabase code callbacks and token-hash callbacks", () => {
    expect(confirm).toContain("code?: string");
    expect(confirm).toContain("validCode");
    expect(action).toContain("exchangeCodeForSession(code)");
    expect(action).toContain("verifyOtp({ token_hash");
  });

  it("keeps already-confirmed signup safe while recovery remains strict", () => {
    expect(action).toContain("current.user?.email_confirmed_at");
    expect(action).toContain('type === "signup"');
    expect(action).toContain("return { error: text.invalidLink }");
  });

  it("routes normal login to the landing page and makes its CTA onboarding-aware", () => {
    expect(action).toContain('redirect("/ru");');
    expect(landing).toContain("authenticated={Boolean(identity)}");
    expect(landingView).toContain('authenticated ? "/account" : "/register"');
  });

  it("prevents accidental resend bursts with a client cooldown", () => {
    expect(form).toContain("resendCooldown");
    expect(form).toContain("Повторить отправку можно через");
  });
});
