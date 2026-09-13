import { describe, expect, it } from "vitest";
import { getMissingRequiredQuestions, isDiagnosticAnswerPresent } from "@/features/diagnostic/diagnostic-runner";

const scale = { id: "scale", answer_type: "scale_0_4", is_required: true } as const;
const text = { id: "text", answer_type: "text", is_required: true } as const;

describe("diagnostic runner required-answer validation", () => {
  it("finds missing required answers while accepting score zero", () => {
    expect(isDiagnosticAnswerPresent(scale, 0)).toBe(true);
    expect(getMissingRequiredQuestions([scale, text], { scale: 0 })).toEqual([text]);
  });

  it("rejects blank required text and preserves optional omissions", () => {
    expect(isDiagnosticAnswerPresent(text, "  ")).toBe(false);
    expect(getMissingRequiredQuestions([{ ...text, is_required: false }], {})).toEqual([]);
  });
});
