import {beforeEach, describe, expect, it, vi} from "vitest";
const state = vi.hoisted(() => ({rows: {} as Record<string, Record<string, unknown>[]>}));
vi.mock("server-only", () => ({}));
vi.mock("@/server-runtime/supabase/admin", () => ({createAdminClient: () => ({from(table: string) {
  const filters: Array<[string, unknown]> = [];
  const rows = () => (state.rows[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value));
  const query = {select: () => query, eq: (key: string, value: unknown) => {filters.push([key, value]); return query;}, order: () => query,
    single: async () => ({data: rows()[0] ?? null, error: null}), maybeSingle: async () => ({data: rows()[0] ?? null, error: null}),
    then: (resolve: (result: unknown) => unknown) => Promise.resolve({data: rows(), error: null}).then(resolve)};
  return query;
}})}));
import {buildAIInput} from "@/server/ai/report";

beforeEach(() => {
  const blocks = Array.from({length: 8}, (_, i) => ({id: `block-${i}`, key: `area_${i}`, position: i + 1, weight: 1, version_id: "methodology", is_active: true}));
  state.rows = {
    diagnostics: [{id: "diagnostic", version_id: "methodology", locale: "en"}],
    diagnostic_company_snapshots: [{diagnostic_id: "diagnostic", profile_data: {name: "Saved company", employee_count: 42, annual_revenue_key: "10m_100m"}}],
    diagnostic_results: [{id: "result", diagnostic_id: "diagnostic", raw_manageability_index: 62.5, display_manageability_index: 62.5, maturity_level_id: "maturity"}],
    diagnostic_blocks: blocks,
    diagnostic_block_results: blocks.map((block, i) => ({result_id: "result", block_id: block.id, raw_score: 50 + i * 2.5, display_score: 50 + i * 2.5})),
    diagnostic_block_translations: blocks.flatMap(block => [{block_id: block.id, locale: "en", title: `English area ${block.position}`}, {block_id: block.id, locale: "ru", title: `Русский блок ${block.position}`}]),
    maturity_levels: [{id: "maturity", position: 2}],
    maturity_level_translations: [{maturity_level_id: "maturity", locale: "en", label: "Developing"}, {maturity_level_id: "maturity", locale: "ru", label: "Зона развития"}],
    questions: [{id: "open", key: "main_management_problem", block_id: "block-0", version_id: "methodology", is_active: true, answer_type: "text"}],
    question_translations: [{question_id: "open", locale: "en", prompt: "What is the main management problem?"}, {question_id: "open", locale: "ru", prompt: "Главная проблема?"}],
    answers: [{diagnostic_id: "diagnostic", question_id: "open", text_value: "Decisions depend on the owner."}],
  };
});

describe("pinned Individual report language", () => {
  it("builds fresh English evidence with translated labels and exact deterministic numbers", async () => {
    const input = await buildAIInput("diagnostic");
    expect(input.locale).toBe("en");
    expect(input.company_snapshot).toMatchObject({company_name: "Saved company", employees_count: 42, annual_revenue: null});
    expect((state.rows.diagnostic_company_snapshots[0].profile_data as Record<string, unknown>).annual_revenue_key).toBe("10m_100m");
    expect(input.deterministic_results).toMatchObject({manageability_index_raw: 62.5, manageability_index_display: "62.5", maturity_level_label: "Developing"});
    expect(input.block_results[1]).toMatchObject({block_title: "English area 2", block_score_raw: 52.5, block_score_display: "52.5"});
    expect(input.open_answers[0]).toEqual({question: "What is the main management problem?", answer: "Decisions depend on the owner."});
    expect(input.derived_facts.block_score_spread).toEqual({raw: 17.5, display: "17.5"});
    expect(JSON.stringify(input)).not.toMatch(/[А-Яа-яЁё]/u);
  });
  it("keeps Russian evidence and comma decimals for a Russian diagnostic", async () => {
    state.rows.diagnostics[0].locale = "ru";
    const input = await buildAIInput("diagnostic");
    expect(input.deterministic_results.manageability_index_display).toBe("62,5");
    expect(input.company_snapshot.annual_revenue).toBe("10m_100m");
    expect(input.block_results[0].block_title).toBe("Русский блок 1");
  });
  it("fails before generation when an English methodology translation is missing", async () => {
    state.rows.diagnostic_block_translations = state.rows.diagnostic_block_translations.filter(row => row.locale !== "en");
    await expect(buildAIInput("diagnostic")).rejects.toThrow("ai_translation_missing");
  });
});
