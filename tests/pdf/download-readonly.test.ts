import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("src/server/pdf/service.ts", "utf8");
const download = readFileSync("src/app/api/reports/[reportId]/pdf/route.ts", "utf8");
const prepare = readFileSync("src/app/api/reports/[reportId]/pdf/prepare/route.ts", "utf8");
const button = readFileSync("src/features/pdf/pdf-download-button.tsx", "utf8");
const adminDownload = readFileSync("src/app/api/admin/report-artifacts/[artifactId]/route.ts", "utf8");

describe("Stage 9B PDF download boundary", () => {
  it("keeps GET read-only and artifact/version bound", () => {
    const getPart = service.slice(service.indexOf("export async function getPdfForReport"), service.indexOf("/** Explicit mutation path"));
    expect(getPart).toContain('eq("status", "ready")');
    expect(getPart).toContain('eq("ai_report_version", report.version)');
    expect(getPart).not.toContain("renderPdf");
    expect(getPart).not.toContain("upsert(");
    expect(download).toContain("getPdfForReport");
    expect(download).not.toContain("preparePdfForReport");
    expect(adminDownload).toContain("await requireAdmin()");
    expect(adminDownload).not.toContain("renderPdf");
    expect(adminDownload).not.toContain("upsert(");
  });

  it("uses an explicit POST preparation path", () => {
    expect(prepare).toContain('export async function POST');
    expect(prepare).toContain("requireIdentity");
    expect(prepare).toContain("preparePdfForReport");
    expect(button).toContain('method: "POST"');
    expect(button).toContain("/pdf/prepare");
    expect(service).toContain("preparationLocks");
    expect(service).toContain("preparePdfForReportUnlocked");
  });

  it("returns safe not-ready states without rendering", () => {
    expect(download).toContain('message === "pdf_not_ready" ? 409');
    expect(service.slice(service.indexOf("export async function getPdfForReport"), service.indexOf("const preparationLocks"))).not.toContain("renderPdf");
  });
});
