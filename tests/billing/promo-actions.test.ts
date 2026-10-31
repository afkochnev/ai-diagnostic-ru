import {beforeEach, describe, expect, it, vi} from "vitest";

const state = vi.hoisted(() => ({identity: vi.fn(), account: vi.fn(), company: vi.fn(), rpc: vi.fn(), origin: vi.fn(), rate: vi.fn(), plan: vi.fn(), revalidate: vi.fn()}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({headers: async () => ({get: state.origin})}));
vi.mock("next/navigation", () => ({redirect: (path: string) => {throw Error(`redirect:${path}`);}}));
vi.mock("next/cache", () => ({revalidatePath: state.revalidate}));
vi.mock("@/server/auth/session", () => ({requireIdentity: state.identity}));
vi.mock("@/server/account/authorization", () => ({requireAccountWrite: state.account, requireCompanyWrite: state.company}));
vi.mock("@/server/supabase/server", () => ({createAuthClient: async () => ({rpc: state.rpc})}));
vi.mock("@/server/supabase/config", () => ({authConfig: () => ({APP_URL: "https://audit.example.test"})}));
vi.mock("@/server/entitlements", () => ({getAccountPlan: state.plan}));
vi.mock("@/server/rate-limit", () => ({enforceRateLimit: state.rate, RateLimitExceeded: class extends Error {}}));
import {redeemAdvancedPromo} from "@/server/billing/promo-actions";

const account = "10000000-0000-4000-8000-000000000001";
const company = "20000000-0000-4000-8000-000000000001";
const until = "2099-11-30T12:00:00+00:00";
function form(values: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({account, company, code: " iteam-1234567890abcdef12345678 ", ...values})) result.set(key, value);
  return result;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.identity.mockResolvedValue({user: {id: "owner"}});
  state.account.mockResolvedValue({id: account});
  state.company.mockResolvedValue({id: company, account_id: account});
  state.origin.mockReturnValue("https://audit.example.test");
  state.rpc.mockResolvedValue({data: {status: "activated", effective_until: until}, error: null});
  state.plan.mockResolvedValue({entitlements: {team_diagnostics: true}});
  state.rate.mockResolvedValue(undefined);
});
describe("Advanced promo redemption", () => {
  it("blocks unauthenticated or unverified callers before touching the account or promo", async () => {
    state.identity.mockRejectedValue(Error("redirect:/ru/login"));
    await expect(redeemAdvancedPromo({}, form())).rejects.toThrow("redirect:/ru/login");
    expect(state.account).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("blocks a foreign Origin", async () => {
    state.origin.mockReturnValue("https://foreign.example.test");
    expect(await redeemAdvancedPromo({}, form())).toHaveProperty("error");
    expect(state.identity).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects a foreign account and never asks the promo RPC to act", async () => {
    state.account.mockRejectedValue(Error("not_found"));
    expect(await redeemAdvancedPromo({}, form())).toHaveProperty("error");
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects an accessible company from a different account", async () => {
    state.company.mockResolvedValue({id: company, account_id: "foreign-account"});
    expect(await redeemAdvancedPromo({}, form())).toHaveProperty("error");
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("canonicalizes the code, rate limits, rereads entitlement, and returns to the same company", async () => {
    await expect(redeemAdvancedPromo({}, form())).rejects.toThrow(`redirect:/ru/companies/${company}/diagnostics?new=1&type=team#team-create`);
    expect(state.identity).toHaveBeenCalledExactlyOnceWith(`/ru/account/plan?account=${account}&company=${company}`);
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("redeem_advanced_promo", {p_account_id: account, p_code: "ITEAM-1234567890ABCDEF12345678"});
    expect(state.rate).toHaveBeenCalledWith("promo:owner", 10, 900);
    expect(state.plan).toHaveBeenCalledWith(account);
    expect(state.revalidate).toHaveBeenCalled();
  });
  it("reports invalid codes without leaking database messages or returning the code", async () => {
    state.rpc.mockResolvedValue({data: {status: "invalid"}, error: null});
    const result = await redeemAdvancedPromo({}, form());
    expect(result.error).toContain("не действует");
    expect(JSON.stringify(result)).not.toContain("12345678"); expect(state.plan).not.toHaveBeenCalled();
    state.rpc.mockResolvedValue({data: null, error: {message: "private schema secret body"}});
    expect(JSON.stringify(await redeemAdvancedPromo({}, form()))).not.toContain("secret body");
  });
  it("does not extend an expired redemption or claim access after a revoked subscription", async () => {
    state.rpc.mockResolvedValue({data: {status: "already_redeemed", effective_until: "2020-01-01T00:00:00Z"}, error: null});
    expect(await redeemAdvancedPromo({}, form())).toHaveProperty("error");
    state.rpc.mockResolvedValue({data: {status: "already_redeemed", effective_until: until}, error: null});
    state.plan.mockResolvedValue({entitlements: {team_diagnostics: false}});
    expect(await redeemAdvancedPromo({}, form())).toHaveProperty("error");
    expect(state.revalidate).not.toHaveBeenCalled();
  });
  it.each(["rate_limited", "billing_managed"])("handles %s without redirect or plan mutation", async status => {
    state.rpc.mockResolvedValue({data: {status}, error: null});
    expect(await redeemAdvancedPromo({}, form())).toHaveProperty("error");
    expect(state.plan).not.toHaveBeenCalled();
  });
  it("confirms an existing Advanced without consuming or promising new days", async () => {
    state.rpc.mockResolvedValue({data: {status: "already_advanced", effective_until: null}, error: null});
    const result = await redeemAdvancedPromo({}, form({company: ""}));
    expect(result.success).toContain("Промокод не использован");
    expect(result.continueHref).toBe(`/ru/accounts/${account}/companies`);
  });
  it("fails closed if the committed plan cannot be read", async () => {
    state.plan.mockRejectedValue(Error("unavailable"));
    expect(await redeemAdvancedPromo({}, form())).toHaveProperty("error");
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});
