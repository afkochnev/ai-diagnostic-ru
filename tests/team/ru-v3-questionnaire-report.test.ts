import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processTeamJob } from "@/server/team/worker";
import {
  parseQualitativeInputForRuV3,
  parseQualitativeInputV2,
  type QualitativeInputV2,
} from "@/server/team/report-v2-contracts";
import { OPEN_GROUPS_WITHOUT_USABLE_EVIDENCE } from "@/server/team/report-v3-contracts";
import { mockTeamSynthesisV3 } from "@/server/team/report-v3-provider";
import { meanEvidence, qualitativeFixture, reportFixture } from "./v3-fixtures";

const provider = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: provider.create }; } }));

const job = { id: "synthetic-job", kind: "team_ai_report" as const, lease_token: "synthetic-lease", attempts: 1 };
const positions = [1, 2, 13, 24, 35, 46, 57, 68, 79, 90, 91, 92, 93];

function questionnaire(size: number, usable = true) {
  const evidence = meanEvidence();
  evidence.methodology.version_number = 5;
  const input: QualitativeInputV2 = qualitativeFixture();
  input.groups = positions.slice(0, size).map((position, index) => {
    const block = evidence.blocks[index - 2] ?? null;
    return {
      question: `Синтетический вопрос ${position}`,
      question_position: position,
      block_title: block?.title ?? "Общие вопросы",
      relevant_block: block,
      response_count: 3,
      texts: usable
        ? ["Согласование задач затянулось из-за передачи решения между ролями.", "Нужны показатели клиентских сроков.", "Срок зависит от очереди на встрече."]
        : ["Пока не могу ответить.", "Нет примера.", "Затрудняюсь."],
    };
  });
  return { evidence, input };
}

function database(evidence: ReturnType<typeof meanEvidence>, input: QualitativeInputV2, synthesis?: unknown) {
  return vi.fn(async (name: string, args: Record<string, unknown>) => {
    void args;
    const prepared = {
      status: "generating", pipeline_version: "TEAM-RU-3", provider_mode: process.env.TEAM_AI_PROVIDER,
      qualitative_input: input, report_input: evidence, synthesis,
    };
    const corpus = {
      threshold: 32,
      identifiers: [],
      answers: input.groups.flatMap(group => group.texts.map(text => ({ question_index: group.question_position, text }))),
    };
    return {
      data: name === "prepare_team_report_job" ? prepared : name === "get_team_synthesis_privacy_corpus" ? corpus : "completed",
      error: null,
    };
  });
}

beforeEach(() => {
  provider.create.mockReset();
  vi.stubEnv("TEAM_AI_PROVIDER", "mock");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Team report for methodology 5", () => {
  it.each([0, 1, 4, 5, 13])("processes %i eligible text groups", async size => {
    const { evidence, input } = questionnaire(size);
    const db = database(evidence, input);
    const status = await processTeamJob(job, db);
    expect(status, JSON.stringify(db.mock.calls.at(-1))).toBe("completed");
    expect(provider.create).not.toHaveBeenCalled();
    const stored = db.mock.calls.find(([name]) => name === "store_team_synthesis")?.[1].p_summary;
    const summary = stored as ReturnType<typeof mockTeamSynthesisV3>;
    expect(new Set(summary.themes.map(theme => theme.question_position)).size).toBe(size);
    expect(db.mock.calls.at(-1)?.[0]).toBe("publish_team_report");
  });

  it("keeps older inputs strict and rejects groups below the anonymity threshold", () => {
    const { input } = questionnaire(13);
    expect(() => parseQualitativeInputV2(input)).toThrow();
    expect(parseQualitativeInputForRuV3(input).groups).toHaveLength(13);
    const group = input.groups[0];
    expect(() => parseQualitativeInputForRuV3({ ...input, groups: [{ ...group, response_count: 2, texts: group.texts.slice(0, 2) }] })).toThrow();
    expect(() => parseQualitativeInputForRuV3({ ...input, groups: [group, group] })).toThrow();
  });

  it("passes scopes to synthesis, safe context to the final prompt, and handles tied means", async () => {
    vi.stubEnv("TEAM_AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "synthetic-only");
    const { evidence, input } = questionnaire(13);
    evidence.blocks = evidence.blocks.map(block => ({ ...block, mean: 50 }));
    const summary = mockTeamSynthesisV3(input, true);
    provider.create
      .mockResolvedValueOnce({ status: "completed", output_text: JSON.stringify(summary) })
      .mockResolvedValueOnce({ status: "completed", output_text: JSON.stringify(reportFixture()) });
    expect(await processTeamJob(job, database(evidence, input))).toBe("completed");
    expect(provider.create).toHaveBeenCalledTimes(2);
    const synthesisRequest = provider.create.mock.calls[0][0];
    const reportRequest = provider.create.mock.calls[1][0];
    expect(synthesisRequest.text.format.name).toBe("team_synthesis_ru_3_questionnaire_5");
    expect(synthesisRequest.input[0].content).toContain("scope определяет назначение");
    expect(synthesisRequest.input[1].content).toContain('"scope":"intro"');
    expect(synthesisRequest.input[1].content).toContain('"scope":"block"');
    expect(synthesisRequest.input[1].content).toContain('"scope":"final"');
    expect(reportRequest.input[0].content).toContain("При equal_block_means");
    expect(reportRequest.input[1].content).toContain('"equal_block_means":true');
    expect(reportRequest.input[1].content).toContain("Синтетический вопрос 93");
    expect(reportRequest.input[1].content).not.toContain(input.groups[0].texts[0]);
  });

  it("records the limit of unusable answers without fabricating evidence", async () => {
    const { evidence, input } = questionnaire(5, false);
    evidence.blocks = evidence.blocks.map(block => ({ ...block, mean: 50 }));
    const db = database(evidence, input);
    expect(await processTeamJob(job, db)).toBe("completed");
    const stored = db.mock.calls.find(([name]) => name === "store_team_synthesis")?.[1].p_summary;
    expect(stored).toMatchObject({ themes: [], management_implications: [OPEN_GROUPS_WITHOUT_USABLE_EVIDENCE] });
    const content = db.mock.calls.find(([name]) => name === "publish_team_report")?.[1].p_content;
    expect(content).toMatchObject({ summary: expect.stringContaining("оценки восьми блоков совпадают"), key_problem_zones: [] });
  });

  it("rejects a fabricated group size in an existing synthesis", async () => {
    const { evidence, input } = questionnaire(5);
    const summary = mockTeamSynthesisV3(input, true);
    summary.themes[0].response_count++;
    const db = database(evidence, input, summary);
    expect(await processTeamJob(job, db)).toBe("failed");
    expect(db.mock.calls.at(-1)?.[1]).toMatchObject({ p_error_code: "team_numeric_integrity", p_retryable: false });
  });
});
