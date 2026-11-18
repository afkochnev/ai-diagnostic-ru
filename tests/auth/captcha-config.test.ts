import { afterEach, describe, expect, it, vi } from "vitest";
import { authCaptchaConfig } from "@/server-runtime/auth-captcha";
import { GET } from "@/app/api/auth/protection/route";

const publicKey = "0x4AAAAAAAJ7SampleSiteKey";
afterEach(() => vi.unstubAllEnvs());

describe("runtime auth CAPTCHA configuration", () => {
  it("keeps existing auth flows available before activation", () => {
    expect(authCaptchaConfig({})).toEqual({ enabled: false, configured: true, siteKey: null });
    expect(authCaptchaConfig({ AUTH_CAPTCHA_ENABLED: "false", TURNSTILE_SITE_KEY: publicKey })).toEqual({ enabled: false, configured: true, siteKey: null });
  });
  it("reads runtime settings without exposing a secret", () => {
    const env = { AUTH_CAPTCHA_ENABLED: "true", TURNSTILE_SITE_KEY: publicKey, TURNSTILE_SECRET_KEY: "never-public", SUPABASE_SERVICE_ROLE_KEY: "never-public" };
    expect(authCaptchaConfig(env)).toEqual({ enabled: true, configured: true, siteKey: publicKey });
  });
  it.each([undefined, "", "not-a-sitekey", "<script>alert(1)</script>"])("fails closed when enabled with invalid key %s", (key) => {
    expect(authCaptchaConfig({ AUTH_CAPTCHA_ENABLED: "true", TURNSTILE_SITE_KEY: key })).toEqual({ enabled: true, configured: false, siteKey: null });
  });
  it("does not silently disable protection for a mistyped activation flag", () => {
    expect(authCaptchaConfig({ AUTH_CAPTCHA_ENABLED: "TRUE", TURNSTILE_SITE_KEY: publicKey })).toEqual({ enabled: true, configured: false, siteKey: null });
  });
  it("serves only public settings and prevents stale activation settings from being cached", async () => {
    vi.stubEnv("AUTH_CAPTCHA_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SITE_KEY", publicKey);
    vi.stubEnv("TURNSTILE_SECRET_KEY", "never-public");
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ enabled: true, configured: true, siteKey: publicKey });
  });
  it("returns an unavailable status instead of offering unprotected submission on bad deployment settings", async () => {
    vi.stubEnv("AUTH_CAPTCHA_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    const response = GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ enabled: true, configured: false, siteKey: null });
  });
});
