import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const state = vi.hoisted(() => ({ diagnosticId: "diagnostic-a", companyId: "company-a", reportId: "report-a" }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ requireIdentity: async () => ({ user: { id: "owner", email: "fixture@example.test" } }) }));
vi.mock("@/server/company/queries", () => ({ getReferenceData: async () => ({ industries: [], revenues: [] }) }));
vi.mock("@/server/company/actions", () => ({ saveCompanyProfileAction: vi.fn(), createCompanyProfileAction: vi.fn() }));
vi.mock("@/features/company/company-navigation", () => ({ CompanyNavigation: () => null }));
vi.mock("@/server/feedback/service", () => ({ getFeedbackStatus: async () => false }));
vi.mock("@/server/diagnostic/result", () => ({ getDiagnosticResult: async () => ({
  diagnostic: { id: state.diagnosticId, company_id: state.companyId, status: "completed", completed_at: null },
  company: { name: state.companyId }, result: { display_manageability_index: 50 }, blocks: [], aiReport: { id: state.reportId, status: "completed" },
}) }));
import { CompanyProfileEditor } from "@/features/company/company-profile-editor";
import { CompanyProfileForm } from "@/features/company/company-profile-form";
import { AIReportSection } from "@/features/ai/ai-report-section";
import ResultPage from "@/app/[locale]/(workspace)/diagnostics/[diagnosticId]/result/page";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
beforeEach(() => { state.diagnosticId = "diagnostic-a"; state.companyId = "company-a"; state.reportId = "report-a"; });

describe("company and report identity reset boundaries", () => {
  it("remounts the profile form when the company changes instead of retaining another profile's fields/revision", async () => {
    const company = { id: "company-a", account_id: "account-a", owner_user_id: "owner", name: "Company A", revision: 3, industry_key: "consulting", country: "Россия", products: "Services", customer_segments: "Companies", sales_channels: "Direct", employee_count: 10, annual_revenue_key: "up_to_10m", company_age_years: 3, management_levels: 2, key_problems: "Planning", main_goals: "Growth", created_at: "2026-10-15", updated_at: "2026-10-15" };
    const first = elements(await CompanyProfileEditor({ company, accountId: "account-a" })).find((node) => node.type === CompanyProfileForm)!;
    const second = elements(await CompanyProfileEditor({ company: { ...company, id: "company-b" }, accountId: "account-a" })).find((node) => node.type === CompanyProfileForm)!;
    expect(first.key).toBe("company-a");
    expect(second.key).toBe("company-b");
    expect(first.key).not.toBe(second.key);
  });

  it("remounts AI content and report actions for a different diagnostic/report", async () => {
    const first = elements(await ResultPage({ params: Promise.resolve({ diagnosticId: state.diagnosticId }) }));
    state.diagnosticId = "diagnostic-b"; state.companyId = "company-b"; state.reportId = "report-b";
    const second = elements(await ResultPage({ params: Promise.resolve({ diagnosticId: state.diagnosticId }) }));
    expect(first.find((node) => node.type === AIReportSection)?.key).toBe("diagnostic-a:report-a");
    expect(second.find((node) => node.type === AIReportSection)?.key).toBe("diagnostic-b:report-b");
    expect(first.find((node) => node.props["data-testid"] === "report-actions")?.key).toBe("report-a");
    expect(second.find((node) => node.props["data-testid"] === "report-actions")?.key).toBe("report-b");
  });
});
