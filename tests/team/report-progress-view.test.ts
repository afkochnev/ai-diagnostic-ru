import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
vi.stubGlobal("React", React);
vi.mock("@/features/team/result-actions", () => ({ TeamResultForm: ({ label,intent,previousReportId }: { label: string;intent:string;previousReportId?:string }) => createElement("form", {"data-intent":intent,"data-previous-report-id":previousReportId},createElement("button", null, label)) }));
vi.mock("@/features/team/report-progress", () => ({ TeamReportProgress: () => createElement("p", null, "Автоматическая проверка и таймер") }));
vi.mock("@/features/team/rich-report", () => ({ RichTeamReport: ({content}:{content:{summary:string}}) => createElement("p",null,content.summary) }));
import { TeamResultsView } from "@/features/team/results";
import type { TeamResults } from "@/server/team/results";
const base: TeamResults = { status: "ready", completed_count: 3, fingerprint: "current", overall: { overall_mean: 50, overall_stddev: 10, overall_min: 25, overall_max: 75 } };
type Report=NonNullable<TeamResults["reports"]>[number];
function report(status:string,overrides:Partial<Report>={}):Report {
  return { id: "report", version: 1, source_fingerprint: "current", completed_participant_count: 3, status, prompt_version: "TEAM-RU-3", model:"gpt-5.6-sol",provider_mode:"openai",structured_content: null, created_at: "2026-10-18T10:00:00Z", error_code: null,...overrides };
}
function reportsView(reports:Report[]) {
  return renderToStaticMarkup(createElement(TeamResultsView, { teamId: "existing", result: { ...base, reports } }));
}
function view(status: string) {
  return reportsView([report(status)]);
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
  it("offers regeneration of a completed real report using that exact previous version",()=>{
    const html=reportsView([report("completed",{id:"real-completed",version:4})]);
    expect(html).toContain("Обновить AI-отчёт");
    expect(html).toContain('data-intent="regenerate"');
    expect(html).toContain('data-previous-report-id="real-completed"');
    expect(html).toContain("Версия 4");
    expect(html).toContain("Скачать PDF");
  });
  it("stops waiting on failure and leaves retry as an explicit owner action", () => {
    expect(view("failed")).toContain("Не удалось подготовить отчёт");
    expect(view("failed")).toContain("Обновить AI-отчёт");
    expect(view("failed")).not.toContain("Автоматическая проверка и таймер");
  });
  it("offers a real report for completed mock while preserving the previous version",()=>{
    const html=reportsView([report("completed",{id:"mock",model:"team-mock-v3",provider_mode:"mock"})]);
    expect(html).toContain("Обновить AI-отчёт");
    expect(html).toContain("реальный AI-отчёт по тем же ответам");
    expect(html).toContain("Предыдущая версия сохранится");
    expect(html).toContain("Версия 1");
    expect(html).toContain('data-intent="report"');
    expect(html).not.toContain("data-previous-report-id");
  });
  it("keeps the real completed version selected and regenerates it when a newer mock exists",()=>{
    const html=reportsView([report("completed",{id:"real"}),report("completed",{id:"mock",version:2,model:"team-mock-v3",provider_mode:"mock"})]);
    expect(html).toContain("Обновить AI-отчёт");
    expect(html).toContain('data-intent="regenerate"');
    expect(html).toContain('data-previous-report-id="real"');
    expect(html).not.toContain("Можно подготовить реальный AI-отчёт");
    expect(html).toMatch(/<details open=""[^>]*><summary[^>]*>Версия 1 /);
    expect(html).toContain("Версия 2");
    expect(html.match(/Скачать PDF/g)).toHaveLength(2);
  });
  it.each(["queued","generating"])("monitors the newer real %s version without offering another request",status=>{
    const html=reportsView([report("completed",{id:"mock",model:"team-mock-v3",provider_mode:"mock"}),report(status,{id:"real",version:2})]);
    expect(html).toContain("Автоматическая проверка и таймер");
    expect(html).not.toContain("Обновить AI-отчёт");
    expect(html).toContain("Версия 1");
    expect(html).toMatch(/<details open=""[^>]*><summary[^>]*>Версия 1 /);
  });
  it.each(["queued","generating"])("keeps the old real report open while monitoring its newer real %s attempt",status=>{
    const html=reportsView([
      report("completed",{id:"old-real",structured_content:{summary:"Сохранённый анализ команды"} as Report["structured_content"]}),
      report(status,{id:"new-real",version:2,model:null}),
      report("completed",{id:"newer-mock",version:3,model:"team-mock-v3",provider_mode:"mock"}),
    ]);
    expect(html).toContain("Автоматическая проверка и таймер");
    expect(html).toContain("Сохранённый анализ команды");
    expect(html).toMatch(/<details open=""[^>]*><summary[^>]*>Версия 1 /);
    expect(html).toContain("Версия 3");
    expect(html.match(/Скачать PDF/g)).toHaveLength(2);
    expect(html).not.toContain("Обновить AI-отчёт");
    expect(html).not.toContain("data-intent");
  });
  it("offers an explicit retry after a newer real attempt fails while keeping the old report readable",()=>{
    const html=reportsView([
      report("completed",{id:"old-real",structured_content:{summary:"Сохранённый анализ команды"} as Report["structured_content"]}),
      report("failed",{id:"failed-real",version:2,model:null,error_code:"provider_unavailable"}),
    ]);
    expect(html).toContain("Не удалось подготовить отчёт. Можно повторить попытку.");
    expect(html).toContain("Обновить AI-отчёт");
    expect(html).toContain('data-intent="report"');
    expect(html).not.toContain("data-previous-report-id");
    expect(html).not.toContain("Автоматическая проверка и таймер");
    expect(html).toContain("Сохранённый анализ команды");
    expect(html).toMatch(/<details open=""[^>]*><summary[^>]*>Версия 1 /);
    expect(html).toContain("Скачать PDF");
  });
});
