import {beforeEach, describe, expect, it, vi} from "vitest";

const state = vi.hoisted(() => ({
  configured: true, signedIn: true, confirmed: true, role: "administrator" as string | null,
  currentLevel: "aal1", nextLevel: "aal1", authError: null as unknown,
  assuranceError: null as unknown, assuranceMissing: false, assurance: vi.fn(), roleLookup: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({cache: (fn: unknown) => fn}));
vi.mock("next/navigation", () => ({redirect: (path: string) => {throw Error(`redirect:${path}`);}}));
vi.mock("@/server/supabase/config", () => ({isAuthConfigured: () => state.configured}));
vi.mock("@/server/supabase/server", () => ({createAuthClient: async () => ({
  auth: {
    getUser: async () => ({data: {user: state.signedIn ? {id: "owner", email_confirmed_at: state.confirmed ? "2026-10-31" : null} : null}, error: state.authError}),
    mfa: {getAuthenticatorAssuranceLevel: state.assurance},
  },
  from: () => ({select: () => ({eq: () => ({single: state.roleLookup})})}),
})}));
vi.mock("@/server/account/queries", () => ({listAccessibleAccounts: vi.fn()}));
vi.mock("@/server/company/queries", () => ({listAccessibleCompanies: vi.fn()}));
import {getIdentity, requireIdentity} from "@/server/auth/session";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {configured: true, signedIn: true, confirmed: true, role: "administrator", currentLevel: "aal1", nextLevel: "aal1", authError: null, assuranceError: null, assuranceMissing: false});
  state.roleLookup.mockImplementation(async () => ({data: state.role ? {role: state.role} : null}));
  state.assurance.mockImplementation(async () => ({data: state.assuranceMissing ? null : {currentLevel: state.currentLevel, nextLevel: state.nextLevel}, error: state.assuranceError}));
});

describe("workspace session MFA", () => {
  it("lets a verified AAL1 administrator use the promo/workspace flow without enrolling MFA", async () => {
    await expect(requireIdentity()).resolves.toMatchObject({role: "administrator", aal: "aal1", nextAal: "aal1"});
    expect(state.roleLookup).toHaveBeenCalledOnce();
    expect(state.assurance).toHaveBeenCalledOnce();
  });

  it("still requires the administrator's configured MFA challenge", async () => {
    state.nextLevel = "aal2";
    await expect(requireIdentity()).rejects.toThrow("redirect:/ru/mfa");
  });

  it("preserves only safe plan context through the MFA challenge without a promo code", async () => {
    state.nextLevel = "aal2";
    const next = "/ru/account/plan?account=10000000-0000-4000-8000-000000000001&company=20000000-0000-4000-8000-000000000001";
    await expect(requireIdentity(next)).rejects.toThrow(`redirect:/ru/mfa?next=${encodeURIComponent(next)}`);
    await expect(requireIdentity(next + "&code=ITEAM-SECRET")).rejects.toThrow("redirect:/ru/mfa");
    await expect(requireIdentity("https://foreign.example.test")).rejects.toThrow("redirect:/ru/mfa");
  });

  it("preserves the existing ordinary-user authorization path", async () => {
    Object.assign(state, {role: "user", nextLevel: "aal2"});
    await expect(requireIdentity()).resolves.toMatchObject({role: "user"});
  });

  it("allows an already verified MFA session without another challenge", async () => {
    Object.assign(state, {currentLevel: "aal2", nextLevel: "aal2"});
    await expect(requireIdentity()).resolves.toMatchObject({aal: "aal2", nextAal: "aal2"});
  });

  it.each(["authError", "assuranceError", "assuranceMissing"])("fails closed when %s prevents session verification", async condition => {
    Object.assign(state, {[condition]: condition === "assuranceMissing" ? true : Error("unavailable")});
    expect(await getIdentity()).toBeNull();
    await expect(requireIdentity()).rejects.toThrow("redirect:/ru/login");
  });

  it("preserves signed-out, email confirmation and revoked role/session gates", async () => {
    state.signedIn = false;
    await expect(requireIdentity()).rejects.toThrow("redirect:/ru/login");
    state.signedIn = true; state.confirmed = false;
    await expect(requireIdentity()).rejects.toThrow("redirect:/ru/verify-email");
    expect(state.roleLookup).not.toHaveBeenCalled();
    expect(state.assurance).not.toHaveBeenCalled();
    state.confirmed = true; state.role = null;
    await expect(requireIdentity()).rejects.toThrow("redirect:/ru/login");
    expect(state.assurance).not.toHaveBeenCalled();
  });
});
