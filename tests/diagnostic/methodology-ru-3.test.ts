import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateBlockScore } from "@/server/scoring/engine";
import { profileAnswerPrefill } from "@/server/diagnostic/profile-prefill";

const migration = readFileSync("supabase/migrations/20261114155511_methodology_ru_3_draft.sql", "utf8");
function unquote(value: string) {
  return value.replaceAll("''", "'");
}

const blocks = Array.from(
  migration.matchAll(/^\s{6}\('([a-z_]+)', '((?:[^']|'')*)'\),?$/gm),
  ([, key, title]) => [key, unquote(title)],
);
const questions = Array.from(
  migration.matchAll(/^\s{6}\('([a-z_]+)', (\d+), '([a-z_]+)', '(scale_0_4|text)', (true|false), '((?:[^']|'')*)'\)[,;]$/gm),
  ([, blockKey, position, key, type, required, text]) => ({
    blockKey, position: Number(position), key, type: type as "scale_0_4" | "text",
    required: required === "true", text: unquote(text),
  }),
);

describe("RU-3 questionnaire import", () => {
  it("matches all 93 ordered records extracted from the approved Word document", () => {
    expect(blocks).toHaveLength(10);
    expect(questions).toHaveLength(93);
    expect(new Set(questions.map((question) => question.key)).size).toBe(93);
    // SHA-256 of [block key, title] and [block key, position, key, kind, required, prompt] from
    // the Word source and semantic keys, excluding only surrounding paragraph whitespace.
    const canonical = JSON.stringify({
      blocks,
      questions: questions.map(({ blockKey, position, key, type, required, text }) => [blockKey, position, key, type, required, text]),
    });
    expect(createHash("sha256").update(canonical).digest("hex")).toBe("d71122aba414178b6774871a9efc681cece5de918543d5bd4cbf1cb4ec6a5189");
  });

  it("retains the introductions and only requires scale questions in the scored blocks", () => {
    const intro = questions.filter((question) => question.blockKey === "company_info");
    expect(intro.map(({ key, type, required }) => [key, type, required])).toEqual([
      ["main_management_problem", "text", true],
      ["main_company_goal", "text", true],
    ]);
    expect(profileAnswerPrefill(intro.map(({ key, type }) => ({ id: key, key, answer_type: type })), {
      key_problems: "Наблюдаемая проблема", main_goals: "Измеримая цель",
    })).toEqual([
      { question_id: "main_management_problem", text_value: "Наблюдаемая проблема" },
      { question_id: "main_company_goal", text_value: "Измеримая цель" },
    ]);
    const final = questions.filter((question) => question.blockKey === "open_questions");
    expect(final.map(({ key, type, required }) => [key, type, required])).toEqual([
      ["management_failures", "text", false],
      ["owner_intervention_cases", "text", false],
      ["missing_manageability_context", "text", false],
    ]);
    for (const [key] of blocks.slice(1, -1)) {
      const block = questions.filter((question) => question.blockKey === key);
      expect(block).toHaveLength(11);
      expect(block.slice(0, 10).every((question) => question.type === "scale_0_4" && question.required)).toBe(true);
      expect(block[10]).toMatchObject({ position: 11, type: "text", required: false });

      const scored = block.map((question) => ({
        id: question.key, answer_type: question.type, weight: question.type === "text" ? 0 : 1,
        reverse_score: false, is_required: question.required, is_active: true,
      }));
      const numeric = scored.slice(0, 10).map((question) => ({ question_id: question.id, numeric_value: 2 }));
      const open = { question_id: block[10].key, numeric_value: null, text_value: "Развёрнутый ответ для проверки. ".repeat(120) };
      expect(calculateBlockScore({ block_id: key, block_weight: 1, questions: scored, answers: numeric }).raw.toNumber()).toBe(50);
      expect(calculateBlockScore({ block_id: key, block_weight: 1, questions: scored, answers: [...numeric, open] }).raw.toNumber()).toBe(50);
    }
  });
});
