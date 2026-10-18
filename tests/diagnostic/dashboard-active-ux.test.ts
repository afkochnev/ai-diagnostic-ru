import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("src/features/company/company-dashboard.tsx", "utf8");

describe("active diagnostic dashboard controls", () => {
  it("renders the account heading copy", () => {
    expect(page).toContain("{copy.dashboard}");
    const messages = readFileSync("src/messages/ru.json", "utf8");
    expect(messages).toContain('"dashboard": "Кабинет управленческой диагностики"');
    expect(messages).not.toContain('"dashboard": "Перейти в кабинет"');
    expect(messages).toContain('"greeting": "Добро пожаловать"');
  });

  it("opens the unified chooser without creating a diagnostic from the dashboard", () => {
    expect(page).toContain('href={`/ru/companies/${company.id}/diagnostics?new=1`}');
    expect(page).not.toContain('startDiagnosticAction');
    expect(page).not.toContain('<form');
    expect(page).toContain('Начать диагностику');
  });
  it("retains the active individual attempt while allowing a separate Team choice", () => {
    expect(page).toContain('href={`/ru/diagnostics/${activeDiagnostic.id}`}');
    expect(page).toContain('Продолжить индивидуальную диагностику');
  });
});
