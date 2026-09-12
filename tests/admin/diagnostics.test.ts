import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("src/server/admin/diagnostics.ts", "utf8");
const page = readFileSync("src/app/[locale]/(admin)/admin/diagnostics/page.tsx", "utf8");
const shell = readFileSync("src/features/admin/admin-shell.tsx", "utf8");

describe("Stage 8B diagnostics list", () => {
  it("uses the shared server-side admin boundary and bounded pagination", () => {
    expect(service).toContain("await requireAdmin()");
    expect(service).toContain("PAGE_SIZE = 20");
    expect(service).toContain('order("started_at", { ascending: false })');
    expect(service).toContain("range((page - 1) * PAGE_SIZE");
    expect(service).not.toContain("answers");
    expect(service).not.toContain("structured_content");
  });

  it("keeps search, filters and page values server-validated", () => {
    expect(service).toContain("slice(0, 100)");
    expect(service).toContain("statuses.includes");
    expect(service).toContain("validDate");
    expect(service).toContain("parsePage");
    expect(page).toContain("Сбросить фильтры");
  });

  it("links the implemented section from the shell without exposing business data there", () => {
    expect(shell).toContain('href="/ru/admin/diagnostics"');
    expect(shell).toContain("Диагностики");
    expect(page).toContain("AI-отчёт");
    expect(page).toContain("Страница");
    expect(page).toContain("Дата начала с");
    expect(page).toContain("Дата начала по");
    expect(page).not.toContain("Создана с");
  });
});
