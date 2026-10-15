import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const data = vi.hoisted(() => ({
  companies: [
    { id: "a1", account_id: "account-a", name: "Компания A1", industry_key: "consulting", country: "Россия", employee_count: 10 },
    { id: "a2", account_id: "account-a", name: "Компания A2", industry_key: "consulting", country: "Россия", employee_count: 20 },
    { id: "b1", account_id: "account-b", name: "Компания B1", industry_key: "consulting", country: "Россия", employee_count: 30 },
  ],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/server/account/authorization", () => ({ requireCompanyRead: async (id: string) => {
  const company = data.companies.find((item) => item.id === id && item.account_id === "account-a");
  if (!company) throw new Error("not_found");
  return company;
} }));
vi.mock("@/server/account/queries", () => ({ listAccessibleAccounts: async () => [{ id: "account-a", name: "Аккаунт A", status: "active" }] }));
vi.mock("@/server/company/queries", () => ({
  listAccessibleCompanies: async (_userId: string, accountId?: string) => data.companies.filter((item) => !accountId || item.account_id === accountId),
  getReferenceData: async () => ({ industries: [{ industry_key: "consulting", name: "Консалтинг" }], revenues: [] }),
}));
import { CompanyNavigation } from "@/features/company/company-navigation";
import { CompanyList } from "@/features/company/company-list";

beforeEach(() => {
  vi.stubEnv("APP_URL", "https://ai-diagnostic-staging-web.onrender.com");
  vi.stubEnv("SUPABASE_URL", "https://vflgxgdwlftlyjslyrmo.supabase.co");
});

describe("V21B company navigation", () => {
  it("shows the current company and only switches to siblings in the current account", async () => {
    const html = renderToStaticMarkup(await CompanyNavigation({ companyId: "a2", userId: "owner-a" }));
    expect(html).toContain("Компания A1");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/ru/companies/a1"');
    expect(html).toContain('href="/ru/companies/a2/profile"');
    expect(html).not.toContain("Компания B1");
    expect(html).not.toContain("diagnosticId");
    expect(html).not.toContain("reportId");
  });

  it("keeps the one-company navigation compact", async () => {
    const original = data.companies;
    data.companies = original.slice(0, 1);
    try {
      const html = renderToStaticMarkup(await CompanyNavigation({ companyId: "a1", userId: "owner-a" }));
      expect(html).toContain("Компания A1");
      expect(html).not.toContain("<details");
    } finally { data.companies = original; }
  });

  it("denies an inaccessible company instead of rendering an alternate company", async () => {
    await expect(CompanyNavigation({ companyId: "b1", userId: "owner-a" })).rejects.toThrow("not_found");
  });

  it("lists companies under their account and offers an account-bound create link", async () => {
    const html = renderToStaticMarkup(await CompanyList({ userId: "owner-a" }));
    expect(html).toContain("Компания A1");
    expect(html).toContain("Компания A2");
    expect(html).toContain("Консалтинг");
    expect(html).toContain('href="/ru/companies/new?from=a1"');
    expect(html).not.toContain("Компания B1");
  });

  it("does not offer additional company creation outside the preview environment", async () => {
    vi.stubEnv("APP_URL", "https://audit.iteam.ru");
    const html = renderToStaticMarkup(await CompanyList({ userId: "owner-a" }));
    expect(html).not.toContain("Добавить компанию");
    expect(html).toContain("Компания A1");
  });

  it("offers clear first-company onboarding without an account creation operation", async () => {
    const original = data.companies;
    data.companies = [];
    try {
      const html = renderToStaticMarkup(await CompanyList({ userId: "owner-a" }));
      expect(html).toContain("Добавьте вашу компанию");
      expect(html).toContain('href="/ru/companies/new"');
    } finally { data.companies = original; }
  });
});
