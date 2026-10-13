import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("src/app/api/diagnostics/[diagnosticId]/reports/route.ts", "utf8");
const worker = readFileSync("src/server/ai/worker.ts", "utf8");
const regeneration = readFileSync("src/server/ai/regeneration.ts", "utf8");
const page = readFileSync("src/app/[locale]/(workspace)/diagnostics/[diagnosticId]/result/page.tsx", "utf8");
const control = readFileSync("src/features/ai/report-regeneration-button.tsx", "utf8");

describe("authenticated report regeneration", () => {
  it("uses current account authority and server version allocation", () => {
    expect(route).toContain("getIdentity");
    expect(route).toContain("export async function POST");
    expect(regeneration).toContain("requestAIReportRegeneration");
    expect(regeneration).toContain("requireDiagnosticWrite(diagnosticId, userId)");
    expect(regeneration).toContain('status !== "completed"');
    expect(regeneration).toContain('status === "generating"');
    expect(regeneration).toContain("current[0]?.version ?? 0");
    expect(route).not.toContain("OPENAI_API_KEY");
    expect(route).not.toContain("ai-regeneration:diagnostic:");
    expect(route).toContain("[report-regeneration]");
    expect(worker).toContain('.eq("deduplication_key", deduplicationKey)');
  });

  it("preserves D13 completed-report fallback and exposes deliberate UI action", () => {
    expect(page).toContain("ReportRegenerationButton");
    expect(page).toContain('data.aiReport?.status === "completed"');
    expect(control).toContain("Сформировать новый отчёт");
    expect(control).toContain("window.location.reload()");
    expect(control).toContain("disabled={state === \"preparing\" || state === \"queued\"}");
  });
});
