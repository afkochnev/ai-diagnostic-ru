import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const progress = readFileSync("src/features/ai/report-generation-progress.tsx", "utf8");
const section = readFileSync("src/features/ai/ai-report-section.tsx", "utf8");
const regeneration = readFileSync("src/features/ai/report-regeneration-button.tsx", "utf8");

describe("AI report generation progress UX", () => {
  it("provides an accessible elapsed-time dialog without fake percentages", () => {
    expect(progress).toContain('role="dialog"');
    expect(progress).toContain('aria-modal="true"');
    expect(progress).toContain("Формируем отчёт");
    expect(progress).toContain("Готовим отчёт о результатах диагностики.");
    expect(progress).toContain("Это займёт примерно 1–2 минуты.");
    expect(progress).toContain("Прошло: {elapsed} сек.");
    expect(progress).toContain("elapsed > 120");
    expect(progress).not.toContain("progressbar");
  });
  it("covers initial and regeneration flows and keeps polling separate", () => {
    expect(section).toContain("ReportGenerationProgress");
    expect(section).toContain("setTimeout(poll,1500)");
    expect(regeneration).toContain("ReportGenerationProgress");
    expect(regeneration).toContain('disabled={state === "preparing" || state === "queued"}');
  });
});
