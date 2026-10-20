import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  accounts: [] as { id: string; name: string; status: string; legacy_origin_user_id: string | null }[],
  empty: false,
  listCompanies: vi.fn(),
  getPlan: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/server/account/queries", () => ({ listAccessibleAccounts: async () => state.accounts }));
vi.mock("@/server/company/queries", () => ({
  listAccessibleCompanies: (...args: unknown[]) => state.listCompanies(...args),
  getReferenceData: async () => ({ industries: [{ industry_key: "consulting", name: "Консалтинг" }], revenues: [] }),
}));
vi.mock("@/server/entitlements", () => ({ getAccountPlan: (...args: unknown[]) => state.getPlan(...args) }));
import { selectCurrentAccount } from "@/server/account/current";
import { CompanyList } from "@/features/company/company-list";
import CompaniesPage from "@/app/[locale]/companies/page";
vi.mock("@/server/auth/session", () => ({ requireIdentity: async () => ({ user: { id: "owner" } }) }));

beforeEach(() => {
  state.accounts = [
    { id: "advanced", name: "Synthetic workspace", status: "active", legacy_origin_user_id: null },
    { id: "personal", name: "Personal workspace", status: "active", legacy_origin_user_id: "owner" },
  ];
  state.empty = false;
  state.listCompanies.mockReset().mockImplementation(async () => state.empty ? [] : [
    { id: "p1", account_id: "personal", name: "Личная компания", industry_key: "consulting", country: "Россия", employee_count: 10 },
    { id: "a1", account_id: "advanced", name: "Команда A", industry_key: "consulting", country: "Россия", employee_count: 20 },
    { id: "a2", account_id: "advanced", name: "Команда B", industry_key: "consulting", country: "Россия", employee_count: 30 },
    { id: "foreign", account_id: "foreign", name: "Чужая компания", industry_key: "", country: "", employee_count: null },
  ]);
  state.getPlan.mockReset().mockImplementation(async (account: string) => ({ plan: account === "advanced" ? "advanced" : "free", display_name: account === "advanced" ? "Advanced" : "Free", entitlements: { multi_company: account === "advanced", team_diagnostics: account === "advanced" } }));
  vi.stubEnv("APP_URL", "https://ai-diagnostic-staging-web.onrender.com");
  vi.stubEnv("SUPABASE_URL", "https://vflgxgdwlftlyjslyrmo.supabase.co");
});

describe("current Account resolution", () => {
  it("uses the provisioned personal Account, never list order", () => {
    for (const accounts of [state.accounts, [...state.accounts].reverse()]) expect(selectCurrentAccount(accounts, "owner")).toMatchObject({ kind: "selected", account: { id: "personal" } });
  });
  it("honors an explicit accessible workspace instead of inheriting the personal plan", () => {
    expect(selectCurrentAccount(state.accounts, "owner", "advanced")).toMatchObject({ kind: "selected", account: { id: "advanced" } });
  });
  it.each(["foreign", "", "malformed"])('denies unknown explicit Account %s without fallback', account => {
    expect(selectCurrentAccount(state.accounts, "owner", account)).toEqual({ kind: "denied" });
  });
  it("supports a sole membership without assuming legacy provenance", () => {
    expect(selectCurrentAccount(state.accounts.slice(0, 1), "owner")).toMatchObject({ kind: "selected", account: { id: "advanced" } });
  });
  it("fails closed when no current workspace can be identified", () => {
    expect(selectCurrentAccount(state.accounts.map(a => ({ ...a, legacy_origin_user_id: null })), "owner")).toEqual({ kind: "ambiguous" });
    expect(selectCurrentAccount([], "owner")).toEqual({ kind: "missing" });
  });
});

describe("flat current-Account Companies page", () => {
  it("shows one Free plan and only personal Companies with an explained locked action", async () => {
    const html = renderToStaticMarkup(await CompanyList({ userId: "owner" }));
    expect(html.match(/Тариф /g)).toHaveLength(1);
    expect(html).toContain("Тариф Free");
    expect(html).toContain("Личная компания");
    expect(html).not.toContain("Команда A"); expect(html).not.toContain("Чужая компания");
    expect(html).not.toContain("Personal workspace"); expect(html).not.toContain("Synthetic workspace");
    expect(state.listCompanies).toHaveBeenCalledExactlyOnceWith("owner", "personal");
    expect(state.getPlan).toHaveBeenCalledExactlyOnceWith("personal");
    expect(html).toContain('href="/ru/account/plan?account=personal"');
    expect(html).toContain('href="/ru/companies/p1"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Добавить компанию — требуется Advanced"');
    expect(html).not.toContain('disabled=""');
    const dialog = html.match(/<dialog[\s\S]*?<\/dialog>/)?.[0];
    expect(dialog).toContain("Несколько компаний доступны на тарифе Advanced.");
    expect(dialog).toContain("Закрыть"); expect(dialog).not.toMatch(/<dialog[^>]*\sopen(?:=|\s|>)/);
    expect(html.replace(dialog ?? "", "")).not.toContain("Подробнее об Advanced");
    expect(html.replace(dialog ?? "", "")).not.toContain("Несколько компаний доступны");
    expect(html).not.toContain("/companies/new?from=");
  });
  it("shows one Advanced plan, two flat cards and one enabled add link", async () => {
    const html = renderToStaticMarkup(await CompanyList({ userId: "owner", accountId: "advanced" }));
    expect(html.match(/Тариф /g)).toHaveLength(1);
    expect(html).toContain("Тариф Advanced");
    expect(html).toContain("Команда A"); expect(html).toContain("Команда B");
    expect(html).not.toContain("Личная компания"); expect(html).not.toContain("Чужая компания");
    expect(html).not.toContain("Synthetic workspace"); expect(html).not.toContain("<section");
    expect(html).not.toContain("Подробнее об Advanced"); expect(html).not.toContain("<dialog");
    expect(html.match(/Добавить компанию/g)).toHaveLength(1);
    expect(html).toContain('href="/ru/companies/new?from=a1"');
    expect(html).toContain('href="/ru/account/plan?account=advanced"');
    expect(state.listCompanies).toHaveBeenCalledExactlyOnceWith("owner", "advanced");
    expect(state.getPlan).toHaveBeenCalledExactlyOnceWith("advanced");
  });
  it("binds zero-company onboarding to the selected Account even with several memberships", async () => {
    state.empty = true;
    const html = renderToStaticMarkup(await CompanyList({ userId: "owner", accountId: "advanced" }));
    expect(html).toContain('href="/ru/companies/new?account=advanced"');
    expect(html).toContain("Добавить вашу компанию"); expect(html).not.toContain("<dialog");
  });
  it("denies foreign scope before loading Companies or commercial state", async () => {
    await expect(CompanyList({ userId: "owner", accountId: "foreign" })).rejects.toThrow("redirect:/ru/access-denied");
    expect(state.listCompanies).not.toHaveBeenCalled(); expect(state.getPlan).not.toHaveBeenCalled();
  });
  it("does not aggregate several memberships without a valid default workspace", async () => {
    state.accounts = state.accounts.map(a => ({ ...a, legacy_origin_user_id: null }));
    const html = renderToStaticMarkup(await CompanyList({ userId: "owner" }));
    expect(html).toContain("Не удалось определить текущую рабочую область");
    expect(state.listCompanies).not.toHaveBeenCalled(); expect(state.getPlan).not.toHaveBeenCalled();
  });
  it("passes the explicit Companies URL scope through to the page", async () => {
    const page = await CompaniesPage({ searchParams: Promise.resolve({ account: "advanced" }) });
    expect(page.props).toMatchObject({ userId: "owner", accountId: "advanced" });
  });
});
