import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch as doesProxyMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";
import { LEGACY_PUBLIC_APP_ORIGIN, PRODUCTION_SUPABASE_URL, PUBLIC_APP_ORIGIN } from "@/shared/app-origin";

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  return {
    getUser,
    createServerClient: vi.fn(() => ({ auth: { getUser } })),
    isAuthConfigured: vi.fn(() => true),
    authConfig: vi.fn(() => ({
      SUPABASE_URL: "https://fhvxqeaujjeiflanqsbg.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key",
      secure: true,
    })),
  };
});
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/server/supabase/config", () => ({ authConfig: mocks.authConfig, isAuthConfigured: mocks.isAuthConfigured }));

const participant = "f1da233d-183a-4a38-9cf2-5c56e99cffe9";
const productionCookie = "sb-fhvxqeaujjeiflanqsbg-auth-token.0=synthetic-cookie";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_URL", PUBLIC_APP_ORIGIN);
  vi.stubEnv("SUPABASE_URL", PRODUCTION_SUPABASE_URL);
  mocks.getUser.mockResolvedValue({ data: { user: null } });
});
afterEach(() => vi.unstubAllEnvs());

describe("canonical domain proxy", () => {
  it.each([
    ["GET", "audit.iteamsystems.com", "/"],
    ["HEAD", "audit.iteamsystems.com", "/ru/free"],
    ["GET", "www.iteamsystems.com", "/en"],
    ["HEAD", "iteamsystems.com", "/ru"],
    ["GET", "audit.iteamsystems.com", "/ru/companies/company/teams/team"],
  ])("redirects %s from %s%s before refreshing a session", async (method, host, path) => {
    const response = await proxy(new NextRequest(`https://${host}${path}?utm_source=old-link`, { method }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${PUBLIC_APP_ORIGIN}${path}?utm_source=old-link`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("keeps the report path, query and hostname boundaries", async () => {
    const path = "/ru//external.example/report?version=3&next=https%3A%2F%2Fexternal.example%2F&filter=a%2Bb";
    const response = await proxy(new NextRequest(LEGACY_PUBLIC_APP_ORIGIN + path));
    expect(response.headers.get("location")).toBe(PUBLIC_APP_ORIGIN + path);
    // No Location fragment is added, so a browser retains any incoming fragment.
    expect(new URL(response.headers.get("location")!).hash).toBe("");
  });

  it.each(["GET", "HEAD"])("redirects %s using the public Host when NextURL contains Render's internal address", async (method) => {
    const request = new NextRequest("http://0.0.0.0:10000/ru/free?source=old-domain-check", {
      method,
      headers: { host: "audit.iteamsystems.com", "x-forwarded-host": "untrusted.example" },
    });
    expect(request.nextUrl.host).not.toBe("audit.iteamsystems.com");
    const response = await proxy(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(PUBLIC_APP_ORIGIN + "/ru/free?source=old-domain-check");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each(["", "audit.iteam.ru", "iteam.ru", "www.iteam.ru", "sub.audit.iteamsystems.com", "audit.iteamsystems.com.external.example", "audit.iteamsystems.com:8443"])(
    "does not fall back to the URL or forwarded host when Host is %s", async (host) => {
      const response = await proxy(new NextRequest(LEGACY_PUBLIC_APP_ORIGIN + "/ru/free", {
        headers: { host, "x-forwarded-host": "audit.iteamsystems.com" },
      }));
      expect(response.headers.get("location")).toBeNull();
      expect(mocks.getUser).toHaveBeenCalledOnce();
    }
  );

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("keeps %s on the incoming origin", async (method) => {
    const response = await proxy(new NextRequest(LEGACY_PUBLIC_APP_ORIGIN + "/ru/free", { method }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it.each([
    "/auth/confirm?type=recovery&code=synthetic-code",
    "/auth/confirm?type=signup&token_hash=synthetic-token",
    "/ru/free/confirm#session=synthetic-session&access=synthetic-access",
    "/ru/team/join#invitation=synthetic-invitation",
    "/ru/team/confirm#token_hash=synthetic-token",
  ])("keeps already-issued callbacks on their original host (%s)", async (path) => {
    const response = await proxy(new NextRequest(LEGACY_PUBLIC_APP_ORIGIN + path));
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it.each([
    ["/ru/free?paused=1", "aca-anonymous=synthetic-cookie"],
    ["/ru/reset-password", "auth-recovery=synthetic-cookie"],
    ["/ru/login?next=team-invitation", "team-invitation=synthetic-cookie"],
    ["/ru/register?next=team-invitation", "team-invitation=synthetic-cookie"],
    ["/ru/verification-complete", productionCookie],
    ["/ru/account", productionCookie],
    ["/ru/dashboard", productionCookie],
    ["/ru/company-profile", productionCookie],
    ["/ru/companies", productionCookie],
    [`/ru/team/responses/${participant}`, productionCookie],
    [`/ru/team/responses/${participant}/result`, productionCookie],
    [`/ru/diagnostics/${participant}/result`, productionCookie],
    [`/ru/billing/return?checkout=${participant}`, productionCookie],
  ])("keeps a legacy continuation with the required cookie (%s)", async (path, cookie) => {
    const response = await proxy(new NextRequest(LEGACY_PUBLIC_APP_ORIGIN + path, { headers: { cookie } }));
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it.each([
    ["/ru/free", "aca-journey=synthetic-cookie"],
    ["/ru/reset-password", "arbitrary=synthetic-cookie"],
    ["/ru/login?next=team-invitation", "arbitrary=synthetic-cookie"],
    ["/ru/login", "team-invitation=synthetic-cookie"],
    ["/ru/account", "sb-staging-auth-token=synthetic-cookie"],
    ["/ru/verification-complete", "arbitrary=synthetic-cookie"],
    ["/ru/account-extra", productionCookie],
    ["/ru/billing/return", productionCookie],
    ["/ru/team/responses/not-a-participant", productionCookie],
    [`/ru/team/responses/${participant}/other`, productionCookie],
    [`/ru/diagnostics/${participant}/result`, "arbitrary=synthetic-cookie"],
  ])("redirects outside the applicable legacy continuation (%s)", async (path, cookie) => {
    const response = await proxy(new NextRequest(LEGACY_PUBLIC_APP_ORIGIN + path, { headers: { cookie } }));
    expect(response.headers.get("location")).toBe(PUBLIC_APP_ORIGIN + path);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each([
    ["APP_URL", "https://external.example"],
    ["APP_URL", PUBLIC_APP_ORIGIN + "/"],
    ["SUPABASE_URL", "https://vflgxgdwlftlyjslyrmo.supabase.co"],
    ["NODE_ENV", "development"],
  ])("retains ordinary handling outside the exact production identity (%s)", async (name, value) => {
    vi.stubEnv(name, value);
    const response = await proxy(new NextRequest(LEGACY_PUBLIC_APP_ORIGIN + "/ru/free"));
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it("restores the old canonical destination when APP_URL is rolled back", async () => {
    vi.stubEnv("APP_URL", LEGACY_PUBLIC_APP_ORIGIN);
    const path = "/ru/free?source=rollback";
    const response = await proxy(new NextRequest(PUBLIC_APP_ORIGIN + path));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(LEGACY_PUBLIC_APP_ORIGIN + path);
    const legacy = await proxy(new NextRequest(LEGACY_PUBLIC_APP_ORIGIN + path));
    expect(legacy.headers.get("location")).toBeNull();
  });

  it.each(["/", "/en"])("leaves session refresh on the original route scopes (%s)", async (path) => {
    const response = await proxy(new NextRequest(PUBLIC_APP_ORIGIN + path));
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("matches public and confirmation routes while leaving APIs, webhooks and assets direct", () => {
    for (const url of ["/", "/ru", "/en", "/ru/free", "/en/diagnostics/example", "/auth/confirm?type=recovery"]) {
      expect(doesProxyMatch({ config, nextConfig: {}, url })).toBe(true);
    }
    for (const url of ["/api/health", "/api/billing/webhook/yookassa", "/api/acquisition/answers", "/dictation/vosk.worker.js", "/_next/static/app.js"]) {
      expect(doesProxyMatch({ config, nextConfig: {}, url })).toBe(false);
    }
  });
});
