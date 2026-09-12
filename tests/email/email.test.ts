import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildReportEmail } from "@/server/email/content";

describe("report email", () => {
  it("builds Russian subject, body and PDF attachment", async () => {
    const email = buildReportEmail({ companyName: "МедТех", index: "61,6", maturity: "Зона развития", filename: "management-ai-audit-medtech-2026-09-10.pdf", contentBase64: "JVBERi0=" });
    email.to = "owner@example.test";
    expect(email.subject).toContain("МедТех");
    expect(email.text).toContain("61,6");
    expect(email.text).toContain("Зона развития");
    expect(email.text).not.toContain("Краткое резюме");
    expect(email.attachment.filename).toMatch(/\.pdf$/);
    expect(email.attachment.contentBase64).toBe("JVBERi0=");
  });

  it("keeps email server-only and does not call OpenAI or scoring", () => {
    const source = readFileSync("src/server/email/service.ts", "utf8");
    expect(source).not.toContain("openai");
    expect(source).not.toContain("runScoring");
    expect(source).toContain("created_by_user_id");
    expect(source).toContain("ai_report_version");
    expect(source).toContain("pdf_artifact_id");
    expect(readFileSync("src/server/email/provider.ts", "utf8")).toContain("class MockEmailProvider");
  });

  it("uses controlled delivery states and active duplicate protection", () => {
    const migration = readFileSync("supabase/migrations/20260914000200_email_deliveries.sql", "utf8");
    expect(migration).toContain("queued");
    expect(migration).toContain("sending");
    expect(migration).toContain("sent");
    expect(migration).toContain("failed");
    expect(migration).toContain("email_deliveries_active_idx");
    expect(migration).toContain("ai_report_version");
    expect(migration).toContain("pdf_artifact_id");
  });

  it("exposes the required controlled UI states", () => {
    const ui = readFileSync("src/features/email/email-report-button.tsx", "utf8");
    expect(ui).toContain("Отправить на email");
    expect(ui).toContain("Отправляем…");
    expect(ui).toContain("Отчёт отправлен");
    expect(ui).toContain("Не удалось отправить отчёт. Попробуйте ещё раз.");
    expect(ui).toContain("disabled");
  });
});
