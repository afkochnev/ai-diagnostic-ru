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

  it("does not disable navigation while autosave is saving and keeps the latest answer synchronously", () => {
    const source = readFileSync("src/features/diagnostic/diagnostic-runner.tsx", "utf8");
    expect(source).toContain("answersRef.current = next;");
    expect(source).toContain("if (navigationPendingRef.current) return;");
    expect(source).toContain('disabled={navigationPending} onClick={() => void navigate(currentIndex + 1)}');
    expect(source).not.toContain('disabled={saving === "saving"} onClick={() => void navigate(currentIndex + 1)}');
  });

  it("keeps required validation on Next while Back bypasses it", () => {
    const source = readFileSync("src/features/diagnostic/diagnostic-runner.tsx", "utf8");
    expect(source).toContain("const navigate = async (index: number, validateRequired = true)");
    expect(source).toContain("if (validateRequired && missing.length)");
    expect(source).toContain('navigate(currentIndex - 1, false)');
    expect(source).toContain('navigate(currentIndex + 1)}');
  });

  it("switches the already-loaded block after save without a refresh round trip", () => {
    const source = readFileSync("src/features/diagnostic/diagnostic-runner.tsx", "utf8");
    expect(source).toContain("const [viewIndex, setViewIndex] = useState(initialIndex);");
    expect(source).toContain("if (await save(data.blocks[index].id)) setViewIndex(index);");
    expect(source).not.toContain("if (await save(data.blocks[index].id)) router.refresh();");
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
