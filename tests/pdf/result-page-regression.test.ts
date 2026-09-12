import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/[locale]/(workspace)/diagnostics/[diagnosticId]/result/page.tsx", "utf8");

describe("result page PDF isolation", () => {
  it("does not enqueue AI or execute PDF generation while rendering", () => {
    expect(page).not.toContain("enqueueAIReport");
    expect(page).not.toContain("getPdfForReport");
    expect(page).not.toContain("renderPdf");
    expect(page).toContain("PdfDownloadButton");
  });
});
