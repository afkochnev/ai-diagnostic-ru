import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("src/server/admin/consultation-leads.ts", "utf8");
const list = readFileSync("src/app/[locale]/(admin)/admin/leads/page.tsx", "utf8");
const detail = readFileSync("src/app/[locale]/(admin)/admin/leads/[leadId]/page.tsx", "utf8");
const returnTo = readFileSync("src/server/admin/return-to.ts", "utf8");

describe("admin consultation leads read model", () => {
  it("guards both read entry points and keeps query read-only", () => {
    expect(service.match(/await requireAdmin\(\)/g)?.length).toBe(2);
    expect(service).not.toMatch(/\.insert\(|\.update\(|worker|resend/i);
    expect(service).toContain('order("created_at", { ascending: false })');
    expect(service).toContain("LEAD_PAGE_SIZE = 20");
  });
  it("validates allowlisted status, delivery and bounded query input", () => {
    expect(service).toContain('"consultation_scheduled"');
    expect(service).toContain('filters.q');
    expect(service).toContain('slice(0, 100)');
    expect(service).toContain('"failed"');
  });
  it("exposes read-only links and no mutation controls", () => {
    expect(list).toContain("Сбросить фильтры"); expect(list).toContain("Открыть");
    expect(detail).toContain("Открыть компанию"); expect(detail).toContain("Открыть пользователя"); expect(detail).toContain("Открыть диагностику");
    expect(detail).not.toMatch(/Изменить|Повторить|Retry|Удалить|Сформировать/);
  });
  it("uses compact delivery states and validates internal return paths", () => {
    expect(detail).toContain("Уведомление отправлено");
    expect(detail).toContain("Техническая информация");
    expect(detail).toContain("Уведомление не отправлено");
    expect(returnTo).toContain("startsWith(\"//\")");
    expect(returnTo).toContain("javascript:");
    expect(returnTo).toContain("ru\\/admin");
  });
});
