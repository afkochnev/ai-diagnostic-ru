import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {NextRequest} from "next/server";
import {unstable_doesMiddlewareMatch as doesProxyMatch} from "next/experimental/testing/server";
import {config, proxy} from "@/proxy";

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  return {
    getUser,
    createServerClient: vi.fn(() => ({auth: {getUser}})),
    isAuthConfigured: vi.fn(() => true),
    authConfig: vi.fn(() => ({
      SUPABASE_URL: "https://fhvxqeaujjeiflanqsbg.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key",
      secure: true,
    })),
  };
});
vi.mock("@supabase/ssr", () => ({createServerClient: mocks.createServerClient}));
vi.mock("@/server/supabase/config", () => ({authConfig: mocks.authConfig, isAuthConfigured: mocks.isAuthConfigured}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_URL", "https://iteamsystems.com");
  vi.stubEnv("SUPABASE_URL", "https://fhvxqeaujjeiflanqsbg.supabase.co");
  mocks.getUser.mockResolvedValue({data: {user: null}});
});
afterEach(() => vi.unstubAllEnvs());

describe("canonical domain proxy", () => {
  it.each(["GET", "HEAD"])("redirects %s before creating or refreshing an auth session", async (method) => {
    const response = await proxy(new NextRequest("https://audit.iteam.ru/auth/confirm?type=recovery&token_hash=synthetic-token", {method}));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://iteamsystems.com/auth/confirm?type=recovery&token_hash=synthetic-token");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.isAuthConfigured).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("keeps the original report path and query while fixing the destination origin", async () => {
    const response = await proxy(new NextRequest("https://audit.iteam.ru/ru/companies/company/teams/team?version=3&next=https%3A%2F%2Fexternal.example%2F&filter=a%2Bb"));
    expect(response.headers.get("location")).toBe("https://iteamsystems.com/ru/companies/company/teams/team?version=3&next=https%3A%2F%2Fexternal.example%2F&filter=a%2Bb");
    // No fragment is added: browsers retain the invitation's original fragment.
    expect(new URL(response.headers.get("location")!).hash).toBe("");
    const doubledPath = await proxy(new NextRequest("https://audit.iteam.ru/ru//external.example/report"));
    expect(doubledPath.headers.get("location")).toBe("https://iteamsystems.com/ru//external.example/report");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("does not redirect %s or replay its payload", async (method) => {
    const response = await proxy(new NextRequest("https://audit.iteam.ru/ru/free", {method, headers: {"next-action": "synthetic-action"}}));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it.each(["iteamsystems.com", "www.iteamsystems.com", "ai-diagnostic-staging-web.onrender.com", "sub.audit.iteam.ru", "audit.iteam.ru.external.example", "external.example", "audit.iteam.ru:8443"])("does not redirect an unlisted host %s", async (host) => {
    const response = await proxy(new NextRequest(`https://${host}/ru/free`, {headers: {"x-forwarded-host": "audit.iteam.ru"}}));
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it.each([
    ["APP_URL", "https://audit.iteam.ru"],
    ["APP_URL", "https://iteamsystems.com/"],
    ["SUPABASE_URL", "https://vflgxgdwlftlyjslyrmo.supabase.co"],
    ["NODE_ENV", "development"],
  ])("keeps ordinary session handling outside the exact production identity (%s)", async (name, value) => {
    vi.stubEnv(name, value);
    const response = await proxy(new NextRequest("https://audit.iteam.ru/ru/account"));
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it("keeps API webhooks and mutations outside the existing proxy matcher", () => {
    for (const url of ["/api/billing/webhook", "/api/acquisition/answers", "/api/team-reports/report/pdf", "/_next/static/app.js"]) {
      expect(doesProxyMatch({config, nextConfig: {}, url})).toBe(false);
    }
    expect(doesProxyMatch({config, nextConfig: {}, url: "/ru/free"})).toBe(true);
    expect(doesProxyMatch({config, nextConfig: {}, url: "/auth/confirm?type=recovery"})).toBe(true);
  });
});
