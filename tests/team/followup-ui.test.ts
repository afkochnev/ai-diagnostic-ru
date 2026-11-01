import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it, vi} from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/features/team/result-actions", () => ({TeamResultForm: () => null}));
vi.mock("@/features/team/report-progress", () => ({TeamReportProgress: () => null}));
vi.mock("@/features/pdf/pdf-download-button", () => ({PdfDownloadButton: () => null}));
vi.mock("@/features/consultation/consultation-modal", () => ({ConsultationModal: ({teamDiagnosticId, reportId, label}: Record<string, string>) => createElement("button", {"data-team": teamDiagnosticId, "data-report": reportId}, label)}));
vi.mock("@/features/feedback/feedback-modal", () => ({FeedbackModal: ({teamDiagnosticId, reportId, label}: Record<string, string>) => createElement("button", {"data-team": teamDiagnosticId, "data-report": reportId}, label)}));
import {TeamResultsView} from "@/features/team/results";
const completed = {id: "completed-report", version: 1, status: "completed", prompt_version: "TEAM-RU-3", source_fingerprint: "source", completed_participant_count: 3, structured_content: null, model: "openai", created_at: "2026-11-01T10:00:00Z", error_code: null};
const result = {status: "ready", completed_count: 3, fingerprint: "source", overall: {overall_mean: 60, overall_stddev: 1, overall_min: 59, overall_max: 61}, maturity: "Зона развития", reports: [completed], blocks: [], questions: []} as unknown as Parameters<typeof TeamResultsView>[0]["result"];
describe("Team report next actions", () => {
  it("offers both actions for the selected completed report even if a later attempt failed", () => {
    const html = renderToStaticMarkup(createElement(TeamResultsView, {teamId: "team", email: "owner@example.test", result: {...result, reports: [...result.reports!, {...completed, id: "failed", version: 2, status: "failed"}]}}));
    expect(html).toContain("Обратиться за консультацией");
    expect(html).toContain("Оценить AI аудит");
    expect(html.match(/data-report="completed-report"/g)).toHaveLength(2);
    expect(html).not.toContain('data-report="failed"');
  });
  it("preserves consultation after feedback and does not offer actions before a completed report exists", () => {
    const rated = renderToStaticMarkup(createElement(TeamResultsView, {teamId: "team", email: "owner@example.test", feedbackExists: true, result}));
    expect(rated).toContain("Обратиться за консультацией"); expect(rated).not.toContain("Оценить AI аудит");
    const pending = renderToStaticMarkup(createElement(TeamResultsView, {teamId: "team", email: "owner@example.test", result: {...result, reports: []}}));
    expect(pending).not.toContain("Обратиться за консультацией"); expect(pending).not.toContain("Оценить AI аудит");
  });
});
