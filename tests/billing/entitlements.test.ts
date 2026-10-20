import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase/server", () => ({ createAuthClient: async () => ({ rpc }) }));
import { getAccountPlan, hasEntitlement, requireEntitlement } from "@/server/entitlements";
const free = { plan: "free", display_name: "Free", entitlements: { multi_company: false, team_diagnostics: false } };
const advanced = { plan: "advanced", display_name: "Advanced", entitlements: { multi_company: true, team_diagnostics: true } };
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: free, error: null }); });
describe("authoritative Account capabilities", () => {
  it("reads only safe commercial state through the authenticated Account RPC", async () => {
    expect(await getAccountPlan("account-a")).toEqual(free);
    expect(rpc).toHaveBeenCalledWith("read_account_plan", { p_account_id: "account-a" });
  });
  it("does not turn Free core diagnostics into a commercial entitlement", async () => {
    expect(await hasEntitlement("account-a", "multi_company")).toBe(false);
    await expect(requireEntitlement("account-a", "team_diagnostics")).rejects.toThrow("advanced_required");
  });
  it("uses freshly read database capabilities after an upgrade without relogin", async () => {
    expect(await hasEntitlement("account-a", "team_diagnostics")).toBe(false);
    rpc.mockResolvedValue({ data: advanced, error: null });
    expect(await hasEntitlement("account-a", "team_diagnostics")).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("fails closed for unknown keys without consulting another capability", async () => {
    expect(await hasEntitlement("account-a", "client_entitlement_true")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("fails closed for RPC errors including foreign-account denial", async () => {
    rpc.mockResolvedValue({ data: advanced, error: { message: "not_found" } });
    expect(await hasEntitlement("foreign-account", "team_diagnostics")).toBe(false);
    await expect(getAccountPlan("foreign-account")).rejects.toThrow("account_plan_unavailable");
  });
  it.each([null, {}, { ...advanced, entitlements: { ...advanced.entitlements, team_diagnostics: "true" } },
    { ...advanced, provider_customer_ref: "must-not-be-returned" }])("rejects malformed/overbroad state %#", async data => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await hasEntitlement("account-a", "team_diagnostics")).toBe(false);
  });
  it("does not share Account A commercial state with Account B", async () => {
    rpc.mockImplementation(async (_name, args) => ({ data: args.p_account_id === "a" ? advanced : free, error: null }));
    expect(await hasEntitlement("a", "multi_company")).toBe(true);
    expect(await hasEntitlement("b", "multi_company")).toBe(false);
  });
});
