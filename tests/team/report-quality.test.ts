import { describe, expect, it, vi } from "vitest";
import { validateAndRepairCoreQuality, type CoreQualityEvent } from "@/server/team/report-quality";
import { inspectCoreQuality, validateCoreQuality } from "@/server/team/report-v3-contracts";
import { mockTeamSynthesisV3 } from "@/server/team/report-v3-provider";
import type { PrivacyCorpus } from "@/server/team/synthesis-privacy";
import { meanEvidence, qualitativeFixture, reportFixture } from "./v3-fixtures";

const corpus: PrivacyCorpus = {threshold: 32, answers: [], identifiers: []};
const synthesis = () => mockTeamSynthesisV3(qualitativeFixture());
const defective = () => ({...reportFixture(), summary: "Разброс оценок требует проверки правил исполнения."});
const fixedSummary = "Оценки управленческих практик требуют проверки правил исполнения.";

describe("bounded Team core quality recovery", () => {
  it("reports existing rule failures using paths and safe reasons, excluding team dynamics", () => {
    const report = reportFixture();
    report.summary = "Разброс оценок требует проверки правил исполнения.";
    report.main_diagnosis = "Тестовая гипотеза требует содержательной проверки.";
    report.first_actions = ["Согласуйте критерии проверки исполнения.", "Согласуйте критерии проверки исполнения."];
    report.team_analysis.divergence = ["Разброс оценок относится к командной динамике."];
    expect(inspectCoreQuality(report, "openai")).toEqual([
      {field_path: "summary", reason: "core_dynamics"},
      {field_path: "main_diagnosis", reason: "test_wording"},
      {field_path: "first_actions[1]", reason: "duplicate_paragraph"},
    ]);
    expect(() => validateCoreQuality(report, "openai", synthesis())).toThrow("team_quality_rejected");
  });

  it("returns a valid report without a repair call", async () => {
    const repair = vi.fn();
    const report = reportFixture();
    expect(await validateAndRepairCoreQuality(report, meanEvidence(), corpus, "openai", synthesis(), repair)).toEqual(report);
    expect(repair).not.toHaveBeenCalled();
  });

  it("repairs only a flagged field once and preserves all other content", async () => {
    const original = defective();
    const repair = vi.fn(async () => ({repairs: [{path: "summary", replacement: fixedSummary}]}));
    const events: CoreQualityEvent[] = [];
    const result = await validateAndRepairCoreQuality(original, meanEvidence(), corpus, "openai", synthesis(), repair, event => events.push(event));
    expect(repair).toHaveBeenCalledExactlyOnceWith(
      [{path: "summary", value: original.summary}],
      [{field_path: "summary", reason: "core_dynamics"}],
    );
    expect(result).toEqual({...original, summary: fixedSummary});
    expect(original.summary).toContain("Разброс");
    expect(events.map(event => event.event)).toEqual(["team_core_quality_detected", "team_core_quality_repaired"]);
    expect(JSON.stringify(events)).not.toContain(original.summary);
    expect(JSON.stringify(repair.mock.calls)).not.toContain(qualitativeFixture().groups[0].texts[0]);
  });

  it("edits only later duplicate occurrences, including list entries", async () => {
    const report = reportFixture();
    report.first_actions = ["Согласуйте критерии проверки исполнения.", "Согласуйте критерии проверки исполнения."];
    const repair = vi.fn(async () => ({repairs: [{path: "first_actions[1]", replacement: "Назначьте разбор результатов проверки исполнения."}]}));
    const result = await validateAndRepairCoreQuality(report, meanEvidence(), corpus, "openai", synthesis(), repair);
    expect(repair.mock.calls).toHaveLength(1);
    expect(result.first_actions[0]).toBe(report.first_actions[0]);
    expect(result.first_actions[1]).toBe("Назначьте разбор результатов проверки исполнения.");
  });

  it("rejects a persistent defect after one call without another repair", async () => {
    const repair = vi.fn(async () => ({repairs: [{path: "summary", replacement: "Разброс оценок по-прежнему требует проверки."}]}));
    await expect(validateAndRepairCoreQuality(defective(), meanEvidence(), corpus, "openai", synthesis(), repair)).rejects.toThrow("team_quality_rejected");
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it.each([
    "Индекс равен 60. Оценки практик требуют проверки.",
    "Стратегия оценена в 50. Оценки практик требуют проверки.",
  ])("rejects changed numeric facts or their attribution: %s", async replacement => {
    const report = {...defective(), summary: "Индекс равен 50. Разброс оценок требует проверки."};
    const repair = vi.fn(async () => ({repairs: [{path: "summary", replacement}]}));
    await expect(validateAndRepairCoreQuality(report, meanEvidence(), corpus, "openai", synthesis(), repair)).rejects.toThrow("team_numeric_integrity");
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("preserves protected numeric statements verbatim during an edit", async () => {
    const report = {...defective(), summary: "Индекс равен 50. Разброс оценок требует проверки."};
    const repair = vi.fn(async () => ({repairs: [{path: "summary", replacement: "Индекс равен 50. Оценки практик требуют предметной проверки."}]}));
    const result = await validateAndRepairCoreQuality(report, meanEvidence(), corpus, "openai", synthesis(), repair);
    expect(result.summary).toBe("Индекс равен 50. Оценки практик требуют предметной проверки.");
    expect(result.participant_count).toBe(report.participant_count);
  });

  it("rejects identifiers or raw answer fragments introduced by repair", async () => {
    const raw = "Исходное описание работы содержит узнаваемую длинную последовательность слов.";
    const privateCorpus: PrivacyCorpus = {threshold: 32, answers: [{question_index: 1, text: raw}], identifiers: []};
    for (const replacement of ["Свяжитесь с private@example.test для проверки исполнения.", raw]) {
      const repair = vi.fn(async () => ({repairs: [{path: "summary", replacement}]}));
      await expect(validateAndRepairCoreQuality(defective(), meanEvidence(), privateCorpus, "openai", synthesis(), repair)).rejects.toThrow("team_privacy_rejected");
      expect(repair).toHaveBeenCalledTimes(1);
    }
  });

  it("does not send initially private text or mock violations to repair", async () => {
    const repair = vi.fn();
    const report = {...defective(), main_diagnosis: "Свяжитесь с private@example.test для проверки исполнения."};
    await expect(validateAndRepairCoreQuality(report, meanEvidence(), corpus, "openai", synthesis(), repair)).rejects.toThrow("team_privacy_rejected");
    await expect(validateAndRepairCoreQuality(defective(), meanEvidence(), corpus, "mock", synthesis(), repair)).rejects.toThrow("team_quality_rejected");
    expect(repair).not.toHaveBeenCalled();
  });

  it("rejects repair fields outside the flagged set", async () => {
    const repair = vi.fn(async () => ({repairs: [{path: "main_diagnosis", replacement: fixedSummary}]}));
    await expect(validateAndRepairCoreQuality(defective(), meanEvidence(), corpus, "openai", synthesis(), repair)).rejects.toThrow("team_quality_rejected");
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized repair plan before a model call", async () => {
    const report = reportFixture();
    report.first_actions = Array.from({length: 6}, (_, index) => `Разброс требует проверки действия ${index}.`);
    report.plan_30_days = Array.from({length: 7}, (_, index) => `Разброс требует проверки первого этапа ${index}.`);
    report.plan_60_days = Array.from({length: 7}, (_, index) => `Разброс требует проверки второго этапа ${index}.`);
    report.plan_90_days = Array.from({length: 7}, (_, index) => `Разброс требует проверки третьего этапа ${index}.`);
    const repair = vi.fn();
    await expect(validateAndRepairCoreQuality(report, meanEvidence(), corpus, "openai", synthesis(), repair)).rejects.toThrow("team_quality_rejected");
    expect(repair).not.toHaveBeenCalled();
  });
});
