import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const report = readFileSync("src/server/ai/report.ts", "utf8");
const snapshotMigration = readFileSync("supabase/migrations/20260912000100_submission_scoring.sql", "utf8");

describe("employee count provenance", () => {
  it("maps the immutable diagnostic snapshot into AI input", () => {
    expect(report).toContain('from("diagnostic_company_snapshots")');
    expect(report).toContain("employees_count: profileData.employee_count");
    expect(snapshotMigration).toContain("diagnostic_snapshots_immutable");
  });
  it("captures the current company profile only when the diagnostic is submitted", () => {
    expect(snapshotMigration).toContain("insert into public.diagnostic_company_snapshots");
    expect(snapshotMigration).toContain("on conflict do nothing");
    expect(report).not.toContain('from("company_profiles").select("employee_count")');
  });
});
