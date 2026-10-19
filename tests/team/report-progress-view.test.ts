import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
vi.stubGlobal("React", React);
vi.mock("@/features/team/result-actions", () => ({ TeamResultForm: ({ label }: { label: string }) => createElement("button", null, label) }));
vi.mock("@/features/team/report-progress", () => ({ TeamReportProgress: () => createElement("p", null, "Автоматическая проверка и таймер") }));
import { TeamResultsView } from "@/features/team/results";
import type { TeamResults } from "@/server/team/results";
const base: TeamResults = { status: "ready", completed_count: 3, fingerprint: "current", overall: { overall_mean: 50, overall_stddev: 10, overall_min: 25, overall_max: 75 } };
function view(status: string) {
  return renderToStaticMarkup(createElement(TeamResultsView, { teamId: "existing", result: { ...base, reports: [{ id: "report", version: 1, source_fingerprint: "current", completed_participant_count: 3, status, prompt_version: "TEAM-RU-3", structured_content: null, created_at: "2026-10-18T10:00:00Z", error_code: null }] } }));
}
describe("Team result report lifecycle", () => {
  it.each(["queued", "generating"])("monitors %s and does not offer another report request", status => {
    const html = view(status);
    expect(html).toContain("Автоматическая проверка и таймер");
    expect(html).not.toContain("Подготовить AI-отчёт");
    expect(html).not.toContain("Обновить AI-отчёт");
  });
  it("removes the waiting component and displays the completed version", () => {
    expect(view("completed")).toContain("Актуальный состав ответов");
    expect(view("completed")).not.toContain("Автоматическая проверка и таймер");
  });
  it("stops waiting on failure and leaves retry as an explicit owner action", () => {
    expect(view("failed")).toContain("Не удалось подготовить отчёт");
    expect(view("failed")).toContain("Обновить AI-отчёт");
    expect(view("failed")).not.toContain("Автоматическая проверка и таймер");
  });
});
