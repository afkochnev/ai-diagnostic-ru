import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("src/server/diagnostic/service.ts", "utf8");
const action = readFileSync("src/server/diagnostic/actions.ts", "utf8");
const dashboard = readFileSync("src/features/company/diagnostics-hub.tsx", "utf8");

describe("start diagnostic flow", () => {
  it("redirects to profile only when the company profile is actually missing", () => {
    expect(service).toContain('new DiagnosticError("company_missing", "Company profile is required")');
    expect(action).toContain('error.code === "company_missing"');
    expect(action).not.toContain('if (error instanceof DiagnosticError) redirect("/ru/company-profile")');
  });

  it("submits the explicit individual choice and does not hard-code a route", () => {
    expect(dashboard).toContain("<form action={startDiagnosticAction}>");
    expect(dashboard).toContain('name="company_id" value={company.id}');
    expect(dashboard).toContain("Начать индивидуальную диагностику");
  });
});
