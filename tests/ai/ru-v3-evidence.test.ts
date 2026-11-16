import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAIInput, generateReport } from "@/server/ai/report";
import { individualPromptForMethodology, RU_V3_INDIVIDUAL_INPUT_VERSION } from "@/server/ai/prompt-version";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown>, generate: vi.fn(), queries: [] as Array<[string, string, unknown]> }));
vi.mock("@/server-runtime/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const response = () => ({ data: state.tables[table] ?? null, error: null });
  const query = {
    select: () => query,
    order: () => query,
    eq: (column: string, value: unknown) => { state.queries.push([table, column, value]); return query; },
    single: async () => response(),
    maybeSingle: async () => response(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(response()).then(resolve),
  };
  return query;
} }) }));
vi.mock("openai", () => ({ default: class { responses = { create: state.generate }; } }));

const blockCodes = ["company_info", "strategy", "structure", "processes", "goals_kpi", "management_rhythm", "team", "motivation", "culture", "open_questions"];
const textQuestions = blockCodes.flatMap((block, index) => {
  const positions = index === 0 ? [1, 2] : index === 9 ? [1, 2, 3] : [11];
  return positions.map(position => ({
    id: `${block}-${position}`, key: `${block}_text_${position}`, block_id: block, answer_type: "text", position,
  }));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FREE_SMOKE_ENABLED", "false");
  vi.stubEnv("AI_REPORT_PROVIDER", "openai");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-not-a-real-key");
  state.queries = [];
  state.tables = {
    diagnostics: { id: "diagnostic", version_id: "methodology-5" },
    diagnostic_company_snapshots: { profile_data: { name: "Вымышленная компания", key_problems: "Заявленная проблема" } },
    diagnostic_results: { id: "result", raw_manageability_index: 50, display_manageability_index: 50, maturity_level_id: "maturity" },
    diagnostic_blocks: blockCodes.map((key, index) => ({ id: key, key, position: index + 1, weight: index === 0 || index === 9 ? 0 : 1 })),
    diagnostic_block_results: blockCodes.slice(1, -1).map(block_id => ({ block_id, raw_score: 50, display_score: 50 })),
    diagnostic_block_translations: blockCodes.map((block_id, index) => ({ block_id, title: index === 0 || index === 9 ? "Общие вопросы" : `Блок ${index}` })),
    maturity_levels: { position: 3 },
    maturity_level_translations: { label: "Зона развития" },
    questions: [...textQuestions, { id: "numeric", key: "numeric", block_id: "strategy", answer_type: "scale_0_4", position: 1 }],
    question_translations: textQuestions.map(question => ({ question_id: question.id, prompt: `Синтетический вопрос ${question.id}` })),
    answers: [{ question_id: "numeric", numeric_value: 1 }],
  };
});

function answer(question_id: string, text_value: string | null) { return { question_id, text_value }; }

describe("RU-v3 individual evidence contract", () => {
  it.each([
    ["manageability", 5, "RU-1.8"], ["manageability", 4, "RU-1.7"], ["another", 5, "RU-1.7"],
  ] as const)("selects %s methodology %i as %s independently of report generation", (definition, version, prompt) => {
    expect(individualPromptForMethodology(definition, version)).toBe(prompt);
  });

  it("builds all 13 text answers in questionnaire order with the three purposes and block metadata", async () => {
    state.tables.answers = [...textQuestions].reverse().map(question => answer(question.id, ` Синтетический ответ ${question.id} `));
    const input = await buildAIInput("diagnostic", "RU-1.8");
    expect(input.input_version).toBe(RU_V3_INDIVIDUAL_INPUT_VERSION);
    expect(input.open_answers).toEqual(textQuestions.map(question => ({
      block_code: question.block_id,
      block_title: question.block_id === "company_info" || question.block_id === "open_questions" ? "Общие вопросы" : `Блок ${blockCodes.indexOf(question.block_id)}`,
      block_position: blockCodes.indexOf(question.block_id) + 1,
      category: question.block_id === "company_info" ? "intro" : question.block_id === "open_questions" ? "final" : "block",
      question_code: question.key, question_position: question.position,
      question: `Синтетический вопрос ${question.id}`, answer: `Синтетический ответ ${question.id}`,
    })));
    expect(state.queries).toContainEqual(["question_translations", "questions.version_id", "methodology-5"]);
    expect(state.queries).toContainEqual(["diagnostic_block_translations", "diagnostic_blocks.version_id", "methodology-5"]);
    expect(await buildAIInput("diagnostic", "RU-1.6")).toEqual(input);
  });

  it("keeps blank responses, numeric answers and responses from outside the pinned questionnaire out of new evidence", async () => {
    const input = await buildAIInput("diagnostic", "RU-1.8");
    expect(input.open_answers).toEqual([]);
    expect(input.derived_facts).toMatchObject({ strongest_blocks: [], weakest_blocks: [], all_blocks_tied: true, block_score_spread: { raw: 0 } });
    state.tables.answers = [answer("strategy-11", "  \t\n"), answer("team-11", null), answer("cross-version", "Чужая запись"), answer("culture-11", "Пример")];
    expect((await buildAIInput("diagnostic", "RU-1.8")).open_answers).toEqual([expect.objectContaining({
      category: "block", block_code: "culture", answer: "Пример",
    })]);
  });

  it("reports all tied extrema from the raw values without inventing singular extremes", async () => {
    (state.tables.diagnostic_block_results as Row[]).forEach((block, index) => {
      block.raw_score = index < 2 ? 75 : index > 5 ? 52.5 : 62.5;
      block.display_score = block.raw_score;
    });
    const input = await buildAIInput("diagnostic", "RU-1.8");
    expect(input.derived_facts).toMatchObject({
      strongest_blocks: [{ block_code: "strategy" }, { block_code: "structure" }],
      weakest_blocks: [{ block_code: "motivation" }, { block_code: "culture" }],
      all_blocks_tied: false, block_score_spread: { raw: 22.5 },
    });
    expect(input.derived_facts).not.toHaveProperty("strongest_block");
  });

  it("retains the exact legacy open-answer and tie shape on the old prompt", async () => {
    state.tables.answers = [answer("strategy-11", " \t"), answer("team-11", null), answer("open_questions-3", "Пример")];
    const input = await buildAIInput("diagnostic", "RU-1.7");
    expect(await buildAIInput("diagnostic", "RU-1.5")).toEqual(input);
    expect(input).not.toHaveProperty("input_version");
    expect(input.open_answers).toEqual([
      { question: "Синтетический вопрос strategy-11", answer: " \t" },
      { question: "Синтетический вопрос team-11", answer: null },
      { question: "Синтетический вопрос open_questions-3", answer: "Пример" },
    ]);
    expect(input.derived_facts).toMatchObject({
      strongest_block: { block_code: "strategy" }, weakest_block: { block_code: "strategy" }, block_score_spread: { raw: 0 },
    });
  });

  it("sends self-report and possible causation guidance in the system message and keeps the text in the data envelope", async () => {
    const respondentText = "Два заказа задержались. Синтетическое предположение респондента о правах на скидки.";
    state.tables.answers = [answer("company_info-1", "Согласовывать быстрее"), answer("processes-11", respondentText), answer("open_questions-3", "Ещё одна заметка")];
    const input = await buildAIInput("diagnostic", "RU-1.8");
    state.generate.mockResolvedValue({ id: "mock", output_text: JSON.stringify({
      summary: "Вы сообщили, что два заказа задержались.",
      main_diagnosis: "Возможная причина заключается в полномочиях на согласование скидок. Эту гипотезу нужно проверить.",
      manageability_index_text: "Оценки блоков равны.",
      strengths: ["Проверить сильные стороны", "Уточнить пример"], key_problem_zones: ["Задержка двух заказов", "Уточнить порядок согласования"],
      growth_constraint: "Данных для установления причины пока мало.", implementation_risks: ["Риск 1", "Риск 2", "Риск 3"],
      first_actions: ["Сверить журнал", "Разобрать случаи", "Согласовать следующий шаг"], plan_30_days: ["Разбор"], plan_60_days: ["Проверка"], plan_90_days: ["Оценка"],
      next_step: "Сопоставить полномочия с двумя примерами.",
    }) });

    const generated = await generateReport(input, "RU-1.8");
    const [system, user] = state.generate.mock.calls[0][0].input;
    expect(system).toMatchObject({ role: "system" });
    expect(system.content).toContain("Если причинная связь не установлена, обозначь её как рабочую гипотезу");
    expect(system.content).toContain("Из среднего балла нельзя вывести ответ на отдельный шкальный вопрос");
    expect(system.content).toContain("Он не говорит о качестве управления");
    expect(system.content).toContain("Вы сообщили, что согласование двух заказов задержалось");
    expect(system.content).not.toContain(respondentText);
    expect(user).toEqual({ role: "user", content: `<UNTRUSTED_DIAGNOSTIC_DATA>\n${JSON.stringify(input)}\n</UNTRUSTED_DIAGNOSTIC_DATA>` });
    expect(input.open_answers).toMatchObject([{ category: "intro" }, { category: "block", answer: respondentText }, { category: "final" }]);
    expect(generated.content.main_diagnosis).toContain("Возможная причина");
  });
});
