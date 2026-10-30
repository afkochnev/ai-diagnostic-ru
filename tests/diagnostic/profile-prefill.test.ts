import { describe, expect, it } from "vitest";
import { profileAnswerPrefill, openQuestionHint } from "@/server/diagnostic/profile-prefill";

describe("profile context in a new diagnostic", () => {
  it("seeds only matching text fields and leaves scores untouched", () => {
    expect(profileAnswerPrefill([
      { id: "problem", key: "main_management_problem", answer_type: "text" },
      { id: "goal", key: "main_company_goal", answer_type: "text" },
      { id: "score", key: "main_company_goal", answer_type: "scale_0_4" },
      { id: "other", key: "other_text", answer_type: "text" },
    ], { key_problems: " Проблема ", main_goals: "Цель" })).toEqual([
      { question_id: "problem", text_value: "Проблема" }, { question_id: "goal", text_value: "Цель" },
    ]);
  });
  it("does not invent or truncate context and gives concise open-answer guidance", () => {
    expect(profileAnswerPrefill([{ id: "p", key: "main_management_problem", answer_type: "text" }], { key_problems: "", main_goals: "Цель" })).toEqual([]);
    expect(openQuestionHint("main_company_goal")).toContain("трёх");
    expect(openQuestionHint("unknown")).toBeNull();
  });
});
