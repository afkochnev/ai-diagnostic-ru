import { describe, expect, it, vi } from "vitest";
const authorize = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("next/navigation", () => ({ redirect: (p: string) => { throw Error(`redirect:${p}`); } }));
vi.mock("@/server/auth/session", () => ({ requireIdentity: async () => ({ user: { id: "owner" } }) }));
vi.mock("@/features/company/company-route", () => ({ requireCompanyRoute: authorize }));
import TeamsPage from "@/app/[locale]/companies/[companyId]/teams/page";
describe("old Team list deep link", () => {
  it("preserves Company authorization and redirects to its unified Team section without writes", async () => {
    await expect(TeamsPage({ params: Promise.resolve({ companyId: "company-b" }) })).rejects.toThrow('redirect:/ru/companies/company-b/diagnostics?type=team#teams');
    expect(authorize).toHaveBeenCalledWith("company-b", "owner");
  });
});
