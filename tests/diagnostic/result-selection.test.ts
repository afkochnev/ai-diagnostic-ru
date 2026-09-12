import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/server/diagnostic/result.ts", "utf8");

describe("D13 report selection", () => {
  it("selects the highest completed report for the exact diagnostic", () => {
    expect(source).toContain('.eq("status", "completed")');
    expect(source).toContain('order("version", { ascending: false })');
    expect(source).toContain("const aiReport = completedReport ?? processReport");
  });

  it("keeps process state only when no usable completed report exists", () => {
    expect(source).toContain('c.from("ai_reports")');
    expect(source).toContain('eq("diagnostic_id", id)');
    expect(source).toContain("const aiReport = completedReport ?? processReport");
    expect(source).not.toContain(".insert(");
    expect(source).not.toContain("fetch(");
  });
});
