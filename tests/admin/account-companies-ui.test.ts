import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ companies: [] as { id: string; name: string; account_id: string }[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/admin/companies-users", () => ({
  getAdminUserDetail: async () => ({
    user: { id: "user-a", full_name: "Owner", email: "owner@example.test", phone: null, created_at: "2026-01-01" },
    companies: state.companies, diagnostics: [],
  }),
}));
import UserDetail from "@/app/[locale]/(admin)/admin/users/[userId]/page";

beforeEach(() => { state.companies = []; });
async function html() {
  return renderToStaticMarkup(await UserDetail({ params: Promise.resolve({ userId: "user-a" }) }));
}

describe("administrator user company projection", () => {
  it("shows every accessible company with an explicit company detail link", async () => {
    state.companies = [
      { id: "company-a", name: "Company A", account_id: "account-a" },
      { id: "company-b", name: "Company B", account_id: "account-a" },
    ];
    const output = await html();
    expect(output).toContain('href="/ru/admin/companies/company-a"');
    expect(output).toContain('href="/ru/admin/companies/company-b"');
    expect(output).toContain("Company A");
    expect(output).toContain("Company B");
    expect(output).toContain("История диагностик пользователя");
  });

  it("preserves the one-company projection without an arbitrary plural fallback", async () => {
    state.companies = [{ id: "company-a", name: "Company A", account_id: "account-a" }];
    expect(await html()).toContain('href="/ru/admin/companies/company-a"');
  });

  it("shows an explicit empty state when no company is currently accessible", async () => {
    expect(await html()).toContain("Компании не найдены.");
  });
});
