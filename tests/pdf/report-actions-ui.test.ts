import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/[locale]/(workspace)/diagnostics/[diagnosticId]/result/page.tsx", "utf8");

describe("report actions presentation", () => {
  it("groups actions with consultation as primary and feedback as tertiary", () => {
    const start = page.indexOf('data-testid="report-actions"');
    const actions = page.slice(start);
    expect(start).toBeGreaterThan(-1);
    expect(actions.indexOf("ConsultationModal")).toBeLessThan(actions.indexOf("PdfDownloadButton"));
    expect(actions).toContain("max-w-[800px]");
    expect(actions).toContain("grid gap-4 sm:grid-cols-2");
    expect(actions).toContain("[&>button]:justify-center");
    expect(actions).toContain("[&_button]:w-full");
    expect(actions).toContain("mt-7 text-center");
    expect(actions).toContain("FeedbackModal");
    expect(actions).not.toContain("Действия с отчётом");
  });

  it("preserves existing report action components and completed-report guard", () => {
    expect(page).toContain('data.aiReport?.status === "completed"');
    expect(page).toContain("PdfDownloadButton");
    expect(page).toContain("EmailReportButton");
    expect(page).toContain("ConsultationModal");
    expect(page).toContain("FeedbackModal");
  });

  it("uses a compact non-interactive email sent status", () => {
    const email = readFileSync("src/features/email/email-report-button.tsx", "utf8");
    expect(email).toContain('role="status"');
    expect(email).toContain("✓ Отчёт отправлен на email");
    expect(email).not.toContain("state === \"sent\" ? \"Отчёт отправлен\"");
  });

  it("keeps feedback trigger link-like rather than button-like", () => {
    const feedback = readFileSync("src/features/feedback/feedback-modal.tsx", "utf8");
    const trigger = feedback.slice(feedback.indexOf('if (state === "closed")'), feedback.indexOf('if (state === "success")'));
    expect(trigger).toContain("underline");
    expect(trigger).not.toContain("border border-brand");
    expect(trigger).not.toContain("bg-brand");
  });
});
