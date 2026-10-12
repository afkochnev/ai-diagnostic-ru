import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const data = vi.hoisted(() => ({
  accounts: [] as { id: string }[],
  companies: [] as { id: string; account_id: string }[],
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/server/auth/session", () => ({ requireIdentity: async () => ({ user: { id: "user-a" } }) }));
vi.mock("@/server/account/queries", () => ({ listAccessibleAccounts: async () => data.accounts }));
vi.mock("@/server/company/queries", () => ({
  listAccessibleCompanies: async () => data.companies,
}));
vi.mock("@/features/company/company-dashboard", () => ({ CompanyDashboard: () => null }));
vi.mock("@/features/company/company-profile-editor", () => ({ CompanyProfileEditor: () => null }));

import DashboardPage from "@/app/[locale]/(workspace)/dashboard/page";
import CompanyProfilePage from "@/app/[locale]/(workspace)/company-profile/page";

beforeEach(() => {
  data.accounts = [{ id: "account-a" }];
  data.companies = [{ id: "company-a", account_id: "account-a" }];
});

async function dashboard(query: { company?: string } = {}) {
  return await DashboardPage({ searchParams: Promise.resolve(query) }) as ReactElement<{ company: { id: string }; userId: string }>;
}
async function profile(query: { company?: string; account?: string } = {}) {
  return await CompanyProfilePage({ searchParams: Promise.resolve(query) }) as ReactElement<{ company: { id: string } | null; accountId: string }>;
}

describe("V1 route compatibility with account ownership", () => {
  it("keeps the one-company dashboard and profile bound to the same company", async () => {
    expect((await dashboard()).props.company.id).toBe("company-a");
    expect((await dashboard()).props.userId).toBe("user-a");
    expect((await profile()).props).toMatchObject({ company: { id: "company-a" }, accountId: "account-a" });
  });

  it("keeps zero-company onboarding explicitly bound to its sole account", async () => {
    data.companies = [];
    await expect(dashboard()).rejects.toThrow("redirect:/ru/company-profile");
    expect((await profile()).props).toEqual({ company: null, accountId: "account-a" });
  });

  it("requires selection when several companies are accessible", async () => {
    data.companies.push({ id: "company-b", account_id: "account-a" });
    await expect(dashboard()).rejects.toThrow("redirect:/ru/companies");
    await expect(profile()).rejects.toThrow("redirect:/ru/companies");
    expect((await dashboard({ company: "company-b" })).props.company.id).toBe("company-b");
    expect((await profile({ company: "company-b" })).props.company?.id).toBe("company-b");
  });

  it("requires account selection when an unprofiled user has multiple accounts", async () => {
    data.companies = [];
    data.accounts.push({ id: "account-b" });
    await expect(profile()).rejects.toThrow("redirect:/ru/companies");
    expect((await profile({ account: "account-b" })).props.accountId).toBe("account-b");
  });

  it("never falls back after an unauthorized company or account request", async () => {
    await expect(dashboard({ company: "company-denied" })).rejects.toThrow("redirect:/ru/access-denied");
    await expect(profile({ company: "company-denied" })).rejects.toThrow("redirect:/ru/access-denied");
    await expect(profile({ account: "account-denied" })).rejects.toThrow("redirect:/ru/access-denied");
  });

  it("requires company/account context to agree when both are supplied", async () => {
    data.accounts.push({ id: "account-b" });
    await expect(profile({ company: "company-a", account: "account-b" })).rejects.toThrow("redirect:/ru/access-denied");
  });
});
