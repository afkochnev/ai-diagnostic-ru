import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getMissingRequiredQuestions, isDiagnosticAnswerPresent } from "@/features/diagnostic/diagnostic-runner";

const scale = { id: "scale", answer_type: "scale_0_4", is_required: true } as const;
const text = { id: "text", answer_type: "text", is_required: true } as const;

describe("diagnostic runner required-answer validation", () => {
  it("renders a visible validation alert and cancels pending autosave", () => {
    const source = readFileSync("src/features/diagnostic/diagnostic-runner.tsx", "utf8");
    expect(source).toContain('data-testid="required-answer-error"');
    expect(source).toContain("Ответьте на все обязательные вопросы, чтобы продолжить.");
    expect(source.indexOf("clearTimeout(timer.current); timer.current = null;", source.indexOf("if (missing.length)"))).toBeLessThan(source.indexOf("setValidationError", source.indexOf("if (missing.length)")));
  });

  it("serializes autosave and explicit block saves", () => {
    const source = readFileSync("src/features/diagnostic/diagnostic-runner.tsx", "utf8");
    expect(source).toContain('const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));');
    expect(source).toContain("const operation = saveQueue.current.then(async () => {");
    expect(source).toContain("saveQueue.current = operation.then(() => true, () => false);");
  });

  it("finds missing required answers while accepting score zero", () => {
    expect(isDiagnosticAnswerPresent(scale, 0)).toBe(true);
    expect(getMissingRequiredQuestions([scale, text], { scale: 0 })).toEqual([text]);
  });

  it("rejects blank required text and preserves optional omissions", () => {
    expect(isDiagnosticAnswerPresent(text, "  ")).toBe(false);
    expect(getMissingRequiredQuestions([{ ...text, is_required: false }], {})).toEqual([]);
  });
});
