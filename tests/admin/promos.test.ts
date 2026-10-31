import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";

const m = vi.hoisted(() => ({admin: vi.fn(), client: vi.fn(), rpc: vi.fn(), origin: vi.fn(), revalidate: vi.fn(), bytes: vi.fn(), redirect: vi.fn()}));
vi.mock("server-only", () => ({}));
vi.mock("node:crypto", async importOriginal => ({...await importOriginal<typeof import("node:crypto")>(), randomBytes: m.bytes}));
vi.mock("@/server/auth/admin", () => ({requireAdmin: m.admin}));
vi.mock("next/headers", () => ({headers: async () => ({get: m.origin})}));
vi.mock("next/cache", () => ({revalidatePath: m.revalidate}));
vi.mock("next/navigation", () => ({redirect: m.redirect}));
vi.mock("@/server/supabase/config", () => ({authConfig: () => ({APP_URL: "https://audit.iteam.ru", AUTH_FLOW_SECRET: "test-server-secret-for-promo-display-0123456789"})}));
vi.mock("@/server/supabase/server", () => ({createAuthClient: m.client}));
import {createAdminPromo, deleteAdminPromo, revokeAdminPromo} from "@/server/admin/promo-actions";
import {listAdminPromos, promoDateBounds} from "@/server/admin/promos";
import {sealAdminPromoCode} from "@/server/admin/promo-code-envelope";

const id = "10000000-0000-4000-8000-000000000001";
const code = `ITEAM-${"A1".repeat(12)}`;
const row = {id, label: "Участники вебинара", code_hint: "ITEAM-…A1A1", max_redemptions: 50, redemptions: 0, redeem_until: "2026-12-01T00:00:00.000Z", revoked_at: null, created_at: "2026-10-31T12:00:00.000Z"};
function form(values: Record<string, string | undefined> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({label: row.label, max_redemptions: "50", redeem_until: "2026-11-30", promo_id: id, ...values})) form.set(key, value ?? "");
  return form;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
  m.admin.mockResolvedValue({user: {id: "admin"}});
  m.client.mockResolvedValue({rpc: m.rpc});
  m.origin.mockReturnValue("https://audit.iteam.ru");
  m.bytes.mockReturnValue(Buffer.from("a1".repeat(12), "hex"));
  m.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => ({error: null, data: name === "admin_list_advanced_promos" ? {rows: [row]} : name === "admin_revoke_advanced_promo" ? {id: args?.p_promo_id, revoked_at: "2026-10-31T12:01:00Z"} : name === "admin_delete_advanced_promo" ? {id: args?.p_promo_id, deleted_at: "2026-10-31T12:01:00Z"} : {...row, label: args?.p_label, max_redemptions: args?.p_max_redemptions, redeem_until: args?.p_redeem_until}}));
});
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});

describe("administrator promo issuance", () => {
  it.each(["create", "revoke", "delete", "list"])("denies a non-administrator before the %s RPC or code generation", async operation => {
    m.admin.mockRejectedValue(Error("denied"));
    const call = operation === "list" ? listAdminPromos() : operation === "create" ? createAdminPromo({}, form()) : operation === "delete" ? deleteAdminPromo({}, form()) : revokeAdminPromo({}, form());
    await expect(call).rejects.toThrow("denied");
    expect(m.client).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled(); expect(m.bytes).not.toHaveBeenCalled();
  });

  it.each([createAdminPromo, revokeAdminPromo, deleteAdminPromo])("rejects cross-origin mutations", async action => {
    m.origin.mockReturnValue("https://foreign.example");
    expect((await action({}, form())).error).toBeTruthy();
    expect(m.client).not.toHaveBeenCalled(); expect(m.bytes).not.toHaveBeenCalled();
  });

  it.each([
    {label: "ab"}, {label: "x".repeat(101)}, {max_redemptions: "0"}, {max_redemptions: "1001"}, {max_redemptions: "1.5"},
    {redeem_until: "2026-10-31"}, {redeem_until: "2027-11-01"}, {redeem_until: "2026-02-31"}, {redeem_until: ""},
  ])("rejects out-of-bounds issuance without generating a code: %o", async values => {
    expect((await createAdminPromo({code: "previous-code"}, form(values))).error).toBeTruthy();
    expect(m.rpc).not.toHaveBeenCalled(); expect(m.bytes).not.toHaveBeenCalled();
  });

  it("creates a random server-side code once and does not put it in a URL, log or revalidation path", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "info"), vi.spyOn(console, "error")];
    const state = await createAdminPromo({}, form({p_code: "CLIENT-CANNOT-CHOOSE", duration_days: "365"}));
    expect(state.code).toBe(code); expect(state.success).toBeTruthy();
    expect(m.bytes).toHaveBeenCalledTimes(2);
    expect(m.bytes.mock.calls).toEqual([[12], [12]]);
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("admin_create_advanced_promo", {p_code: code, p_label: row.label, p_max_redemptions: 50, p_redeem_until: "2026-12-01T00:00:00.000Z", p_code_ciphertext: expect.stringMatching(/^v1\.[a-f0-9]{24}\.[a-f0-9]{60}\.[a-f0-9]{32}$/)});
    expect(m.revalidate.mock.calls).toEqual([["/ru/admin/promos"]]);
    expect(m.redirect).not.toHaveBeenCalled(); logs.forEach(log => expect(log).not.toHaveBeenCalled());
  });

  it.each([{max_redemptions: "1", redeem_until: "2026-11-01"}, {max_redemptions: "1000", redeem_until: "2027-10-31"}])("accepts the documented inclusive calendar bounds: %o", async values => {
    expect((await createAdminPromo({}, form(values))).code).toBe(code);
  });

  it("uses a 30-day default redemption date without accepting a client-specified access duration", () => {
    expect(promoDateBounds()).toEqual({minimum: "2026-11-01", maximum: "2027-10-31", initial: "2026-11-30"});
  });

  it("returns a safe failure without the full code or provider body after an uncertain create", async () => {
    m.rpc.mockResolvedValue({data: null, error: {message: `private body ${code}`}});
    const state = await createAdminPromo({}, form());
    expect(state.error).toContain("Проверьте список");
    expect(state.code).toBeUndefined(); expect(JSON.stringify(state)).not.toContain(code); expect(JSON.stringify(state)).not.toContain("private body");
    expect(m.rpc).toHaveBeenCalledOnce();
  });

  it("does not trust a plaintext field from the RPC or pretend that a legacy hash is recoverable", async () => {
    m.rpc.mockResolvedValue({error: null, data: {rows: [{...row, code, code_hash: createHash("sha256").update(code).digest("hex")}], code}});
    const {rows} = await listAdminPromos();
    expect(rows).toEqual([{...row, code: null, codeStatus: "legacy"}]);
    expect(JSON.stringify(rows)).not.toContain(code); expect(rows[0]).not.toHaveProperty("code_hash");
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("admin_list_advanced_promos");
  });

  it("reopens the stored encrypted code on each administrator list read without exposing storage fields", async () => {
    const ciphertext = sealAdminPromoCode(code, "test-server-secret-for-promo-display-0123456789");
    const stored = {...row, code_ciphertext: ciphertext, code_hash: createHash("sha256").update(code).digest("hex")};
    m.rpc.mockResolvedValue({error: null, data: {rows: [stored]}});
    for (let read = 0; read < 2; read++) {
      const {rows} = await listAdminPromos();
      expect(rows).toEqual([{...row, code, codeStatus: "available"}]);
      expect(rows[0]).not.toHaveProperty("code_hash"); expect(rows[0]).not.toHaveProperty("code_ciphertext");
    }
  });

  it("keeps a corrupt encrypted code unavailable instead of returning an unverified code", async () => {
    m.rpc.mockResolvedValue({error: null, data: {rows: [{...row, code_ciphertext: "invalid", code_hash: "0".repeat(64)}]}});
    const {rows} = await listAdminPromos();
    expect(rows).toEqual([{...row, code: null, codeStatus: "unavailable"}]);
  });

  it("rejects an oversized hint or an unbounded list instead of exposing it", async () => {
    m.rpc.mockResolvedValueOnce({error: null, data: {rows: [{...row, code_hint: code}]}});
    await expect(listAdminPromos()).rejects.toThrow();
    m.rpc.mockResolvedValueOnce({error: null, data: {rows: Array.from({length: 26}, () => row)}});
    await expect(listAdminPromos()).rejects.toThrow();
  });

  it("revokes by validated ID and preserves the fixed local return path", async () => {
    const state = await revokeAdminPromo({}, form());
    expect(state.success).toContain("Уже выданный доступ сохранён");
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("admin_revoke_advanced_promo", {p_promo_id: id});
    expect(m.revalidate.mock.calls).toEqual([["/ru/admin/promos"]]);
    expect(m.bytes).not.toHaveBeenCalled(); expect(m.redirect).not.toHaveBeenCalled();
  });

  it.each([revokeAdminPromo, deleteAdminPromo])("rejects a forged promo ID before any RPC", async action => {
    expect((await action({}, form({promo_id: "wrong"}))).error).toBeTruthy();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("removes a code through the administrator RPC and does not change subscriptions", async () => {
    const state = await deleteAdminPromo({}, form());
    expect(state.success).toContain("Уже выданный доступ сохранён");
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("admin_delete_advanced_promo", {p_promo_id: id});
    expect(m.revalidate.mock.calls).toEqual([["/ru/admin/promos"]]);
    expect(m.bytes).not.toHaveBeenCalled();
  });

  it.each([{data: null, error: {message: "private body"}}, {data: {id: "20000000-0000-4000-8000-000000000002", deleted_at: "2026-10-31T12:01:00Z"}, error: null}])("does not report deletion success for a failed or mismatched result", async result => {
    m.rpc.mockResolvedValue(result);
    const state = await deleteAdminPromo({}, form());
    expect(state.error).toBeTruthy(); expect(state.success).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("private body");
    expect(m.revalidate).not.toHaveBeenCalled();
  });
});
