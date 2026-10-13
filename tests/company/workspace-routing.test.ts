import { describe, expect, it } from "vitest";
import { resolveCompanySelection, workspaceDestination } from "@/features/company/workspace-routing";

const companies = [{ id: "company-a", account_id: "account-a" }, { id: "company-b", account_id: "account-a" }];

describe("account/company workspace selection", () => {
  it("preserves V1 dashboard and onboarding destinations", () => {
    expect(workspaceDestination(1, 1)).toBe("/ru/dashboard");
    expect(workspaceDestination(0, 1)).toBe("/ru/company-profile");
  });

  it("requires company or account selection whenever context is ambiguous", () => {
    expect(workspaceDestination(2, 1)).toBe("/ru/companies");
    expect(workspaceDestination(0, 2)).toBe("/ru/companies");
    expect(workspaceDestination(0, 0)).toBe("/ru/companies");
    expect(resolveCompanySelection(companies)).toEqual({ kind: "ambiguous" });
  });

  it("resolves an explicitly selected accessible company without picking the first", () => {
    expect(resolveCompanySelection(companies, "company-b")).toEqual({ kind: "selected", company: companies[1] });
  });

  it("does not fall back to another company for denied, deleted or malformed IDs", () => {
    for (const requestedId of ["company-denied", "", "not-a-uuid"]) {
      expect(resolveCompanySelection(companies, requestedId)).toEqual({ kind: "inaccessible" });
    }
    expect(resolveCompanySelection([], "company-a")).toEqual({ kind: "inaccessible" });
  });

  it("distinguishes absent profiles from a unique accessible profile", () => {
    expect(resolveCompanySelection([])).toEqual({ kind: "missing" });
    expect(resolveCompanySelection(companies.slice(0, 1))).toEqual({ kind: "selected", company: companies[0] });
  });
});
