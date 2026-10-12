import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  signedIn: true, verified: true, role: "user", aal: "aal1", companyCount: 1, accountCount: 1,
  companies: vi.fn(), accounts: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/supabase/config", () => ({ isAuthConfigured: () => true }));
vi.mock("@/server/supabase/server", () => ({
  createAuthClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.signedIn ? { id: "user-a", email_confirmed_at: state.verified ? "2026-01-01" : null } : null } }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: state.aal } }) },
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: state.role } }) }) }) }),
  }),
}));
vi.mock("@/server/company/queries", () => ({ listAccessibleCompanies: state.companies }));
vi.mock("@/server/account/queries", () => ({ listAccessibleAccounts: state.accounts }));
import { signedInDestination } from "@/server/auth/session";

beforeEach(() => {
  Object.assign(state, { signedIn: true, verified: true, role: "user", aal: "aal1", companyCount: 1, accountCount: 1 });
  state.companies.mockReset().mockImplementation(async () => Array.from({ length: state.companyCount }, (_, index) => ({ id: `company-${index}` })));
  state.accounts.mockReset().mockImplementation(async () => Array.from({ length: state.accountCount }, (_, index) => ({ id: `account-${index}` })));
});

describe("signed-in account destinations", () => {
  it("preserves one-company V1 destination and uses verified membership lookups", async () => {
    expect(await signedInDestination()).toBe("/ru/dashboard");
    expect(state.companies).toHaveBeenCalledWith("user-a");
    expect(state.accounts).toHaveBeenCalledWith("user-a");
  });

  it("requires selection for several companies or several unprofiled accounts", async () => {
    state.companyCount = 2;
    expect(await signedInDestination()).toBe("/ru/companies");
    state.companyCount = 0;
    state.accountCount = 2;
    expect(await signedInDestination()).toBe("/ru/companies");
  });

  it("preserves verification and login gates before any account lookup", async () => {
    state.verified = false;
    expect(await signedInDestination()).toBe("/ru/verify-email");
    state.signedIn = false;
    expect(await signedInDestination()).toBe("/ru/login");
    expect(state.companies).not.toHaveBeenCalled();
    expect(state.accounts).not.toHaveBeenCalled();
  });

  it("keeps the global administrator role and MFA independent of account ownership", async () => {
    state.role = "administrator";
    expect(await signedInDestination()).toBe("/ru/mfa");
    state.aal = "aal2";
    expect(await signedInDestination()).toBe("/ru/admin");
    expect(state.companies).not.toHaveBeenCalled();
    expect(state.accounts).not.toHaveBeenCalled();
  });
});
