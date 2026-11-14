import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.generated";

vi.mock("server-only", () => ({}));
import { loadQuestionnaire } from "@/server/diagnostic/questionnaire";

const firstOption = { id: "option-one", position: 1, score_value: 0, question_option_translations: [{ label: "1" }] };
const block = { id: "one-block", key: "strategy", position: 2, weight: 1, is_active: true, diagnostic_block_translations: [{ title: "Стратегия" }] };
const versionFive = [
  {
    id: "scale-v5", block_id: "one-block", key: "strategy_document_access", position: 10, answer_type: "scale_0_4",
    weight: 1, is_required: true, is_active: true, reverse_score: false,
    question_translations: [{ prompt: "Стратегия зафиксирована", help_text: null }],
    question_options: [firstOption],
  },
  {
    id: "text-v5", block_id: "one-block", key: "strategy_summary", position: 11, answer_type: "text",
    weight: 0, is_required: false, is_active: true, reverse_score: false,
    question_translations: [{ prompt: "Опишите вашу стратегию", help_text: null }],
    question_options: [],
  },
];
const versionFour = [{
  ...versionFive[0],
  id: "intro-v4",
  key: "main_management_problem",
  answer_type: "text",
  question_translations: [{ prompt: "Прежний вопрос", help_text: null }],
  question_options: [],
}];

describe("version-pinned questionnaire loading", () => {
  it("embeds options and Russian text under the requested version and joins its saved answers", async () => {
    const mockFetch = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const storedVersion = url.searchParams.get("version_id");
      const rows = url.pathname.endsWith("/diagnostic_blocks") ? [block] : storedVersion === "eq.v-five" ? versionFive : versionFour;
      return Response.json(rows);
    });
    const client = createClient<Database>("https://fixture.test", "fake-key", { global: { fetch: mockFetch } });
    const answer = { question_id: "text-v5", text_value: "Развёрнутый ответ", numeric_value: null, revision: 1 };
    const current = await loadQuestionnaire(client, "v-five", [answer]);
    const old = await loadQuestionnaire(client, "v-four", [answer]);

    expect(current[0].questions.map(({ prompt }) => prompt)).toEqual(["Стратегия зафиксирована", "Опишите вашу стратегию"]);
    expect(current[0].questions[0].options).toEqual([{ id: "option-one", position: 1, score_value: 0, label: "1" }]);
    expect(current[0].questions[1]).toMatchObject({ position: 11, is_required: false, options: [], answer });
    expect(old[0].questions).toHaveLength(1);
    expect(old[0].questions[0]).toMatchObject({ prompt: "Прежний вопрос", answer: null });
    expect(old[0].questions[0].help_text).toContain("Достаточно нескольких предложений");

    const requests = mockFetch.mock.calls.map(([url]) => new URL(String(url)));
    expect(requests).toHaveLength(4);
    expect(requests.map((url) => url.searchParams.get("version_id"))).toEqual(["eq.v-five", "eq.v-five", "eq.v-four", "eq.v-four"]);
    for (const request of requests.filter((url) => url.pathname.endsWith("/questions"))) {
      expect(request.searchParams.get("select")).toContain("question_options(");
      expect(request.searchParams.get("question_translations.locale")).toBe("eq.ru");
      expect(request.searchParams.get("question_options.question_option_translations.locale")).toBe("eq.ru");
      expect(request.searchParams.get("question_options.order")).toBe("position.asc");
    }
  });

  it("retains explicit guidance choices instead of showing a fallback meant for an older question", async () => {
    const mockFetch = vi.fn<typeof fetch>(async (input) => Response.json(
      String(input).includes("/questions?") ? [{
        ...versionFour[0],
        question_translations: [{ prompt: "Новый вводный вопрос", help_text: "" }],
      }] : [block],
    ));
    const client = createClient<Database>("https://fixture.test", "fake-key", { global: { fetch: mockFetch } });
    const result = await loadQuestionnaire(client, "v-five", []);
    expect(result[0].questions[0].help_text).toBe("");
  });
});
