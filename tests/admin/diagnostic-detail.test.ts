import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("src/server/admin/diagnostic-detail.ts", "utf8");
const page = readFileSync("src/app/[locale]/(admin)/admin/diagnostics/[diagnosticId]/page.tsx", "utf8");
const list = readFileSync("src/app/[locale]/(admin)/admin/diagnostics/page.tsx", "utf8");
const artifactRoute = readFileSync("src/app/api/admin/report-artifacts/[artifactId]/route.ts", "utf8");

describe("Stage 8C diagnostic detail", () => {
  it("uses server-side admin authorization and a bounded batched read model", () => {
    expect(service).toContain("await requireAdmin()");
    expect(service).toContain("Promise.all");
    expect(service).toContain("diagnosticId");
    expect(service).toContain("started_at");
    expect(service).not.toContain("insert(");
    expect(service).not.toContain("update(");
  });

  it("renders read-only detail sections and explicit report/artifact versions", () => {
    for (const title of ["Сведения о диагностике", "Профиль компании", "Результаты диагностики", "Ответы", "AI-отчёты", "PDF-артефакты"]) expect(page).toContain(title);
    expect(page).toContain("Версия {report.version}");
    expect(page).toContain("artifact.ai_report_version");
    expect(page).not.toContain("Сформировать");
    expect(page).not.toContain("Пересчитать");
  });

  it("includes the complete company profile contract with human-readable labels", () => {
    for (const label of ["Название компании", "Страна", "Отрасль", "Продукты", "Клиенты / клиентские сегменты", "Каналы продаж", "Число сотрудников", "Годовой оборот", "Возраст компании", "Количество уровней управления", "Ключевые проблемы компании", "Главные цели компании"]) expect(page).toContain(label);
    expect(service).toContain("diagnostic_company_snapshots");
    expect(service).toContain("industry_translations");
    expect(service).toContain("revenue_range_translations");
    expect(service).toContain("profileUnavailable");
    expect(service).toContain("diagnostic.status === \"completed\"");
    expect(page).toContain("Исторический профиль компании недоступен.");
    expect(page).not.toContain("owner_user_id");
    expect(page).not.toContain("updated_at");
  });

  it("links each list row to detail and protects artifact downloads", () => {
    expect(list).toContain("/ru/admin/diagnostics/${row.id}");
    expect(artifactRoute).toContain("await requireAdmin()");
    expect(artifactRoute).toContain('"application/pdf"');
  });
});
