import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportGenerationProgress } from "@/features/ai/report-generation-progress";

afterEach(() => vi.unstubAllGlobals());

const progress = readFileSync("src/features/ai/report-generation-progress.tsx", "utf8");
const section = readFileSync("src/features/ai/ai-report-section.tsx", "utf8");
const regeneration = readFileSync("src/features/ai/report-regeneration-button.tsx", "utf8");

describe("AI report generation progress UX", () => {
  it("provides an accessible elapsed-time dialog without fake percentages", () => {
    expect(progress).toContain('role="dialog"');
    expect(progress).toContain('aria-modal="true"');
    expect(progress).toContain("Формируем отчёт");
    expect(progress).toContain("Подготовка отчёта займёт от 1 до 2 минут.");
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(React.createElement(ReportGenerationProgress, { state: "generating", elapsedSeconds: 42 }));
    expect(html).toContain("Прошло: 42 сек.");
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
