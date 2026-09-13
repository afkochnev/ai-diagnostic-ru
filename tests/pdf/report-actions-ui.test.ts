import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/[locale]/(workspace)/diagnostics/[diagnosticId]/result/page.tsx", "utf8");

describe("report actions presentation", () => {
  it("groups actions with consultation as primary and feedback as tertiary", () => {
    const start = page.indexOf('data-testid="report-actions"');
    const actions = page.slice(start);
    expect(start).toBeGreaterThan(-1);
    expect(actions.indexOf("ConsultationModal")).toBeLessThan(actions.indexOf("PdfDownloadButton"));
    expect(actions).toContain("grid gap-3 sm:grid-cols-2");
    expect(actions).toContain("[&>button]:w-full");
    expect(actions).toContain("[&>button]:border-line");
    expect(actions).toContain("FeedbackModal");
  });

  it("preserves existing report action components and completed-report guard", () => {
    expect(page).toContain('data.aiReport?.status === "completed"');
    expect(page).toContain("PdfDownloadButton");
    expect(page).toContain("EmailReportButton");
    expect(page).toContain("ConsultationModal");
    expect(page).toContain("FeedbackModal");
  });
});
