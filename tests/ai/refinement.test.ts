import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatDecimalRu, formatIntegerRu, formatPercentRu } from "@/server/ai/format";
import { deriveBlockFacts, type AIBlockFact } from "@/server/ai/facts";

const blocks: AIBlockFact[] = [
  ["strategy", "Стратегия", 75], ["structure", "Организационная структура", 62.5], ["processes", "Бизнес-процессы", 57.5], ["goals_kpi", "Цели и показатели", 62.5], ["management_rhythm", "Управленческий ритм", 60], ["team", "Команда и управленческая зрелость", 62.5], ["motivation", "Мотивация и ответственность", 60], ["culture", "Корпоративная культура", 52.5],
].map(([block_code, block_title, block_score_raw]) => ({ block_code: String(block_code), block_title: String(block_title), block_score_raw: Number(block_score_raw), block_score_display: formatDecimalRu(Number(block_score_raw)) }));

describe("RU-1.1 AI facts", () => {
  it("derives the pinned block facts exactly", () => {
    const facts = deriveBlockFacts(blocks);
    expect(facts.strongest_block).toMatchObject({ title: "Стратегия", score_raw: 75, score_display: "75" });
    expect(facts.weakest_block).toMatchObject({ title: "Корпоративная культура", score_raw: 52.5, score_display: "52,5" });
    expect(facts.block_score_spread).toEqual({ raw: 22.5, display: "22,5" });
    expect(facts.blocks_60_to_62_5_count).toBe(5);
    expect(facts.blocks_below_60).toHaveLength(2);
    expect(facts.blocks_70_plus).toHaveLength(1);
  });
  it("formats display values without trailing zero", () => {
    expect(formatDecimalRu(61.6)).toBe("61,6");
    expect(formatDecimalRu(62.5)).toBe("62,5");
    expect(formatDecimalRu(75)).toBe("75");
    expect(formatDecimalRu(60)).toBe("60");
    expect(formatDecimalRu(52.5)).toBe("52,5");
    expect(formatDecimalRu(22.5)).toBe("22,5");
    expect(formatPercentRu(30)).toBe("30%");
    expect(formatIntegerRu(70)).toBe("70");
  });
});

describe("RU-1.2 prompt contract", () => {
  const root = process.cwd();
  const prompt = readFileSync(join(root, "AI_REPORT_PROMPT_RU_1_2.md"), "utf8");
  it("exists and preserves the previous prompt/schema files", () => {
    expect(prompt.length).toBeGreaterThan(1000);
    expect(createHash("sha256").update(readFileSync(join(root, "AI_REPORT_PROMPT_RU_1_0.md"))).digest("hex")).toBe("d80d6e110256ad00df4197aabd2ca95043298e66a8adaeb7b30524e7fd494206");
    expect(createHash("sha256").update(readFileSync(join(root, "AI_REPORT_PROMPT_RU_1_1.md"))).digest("hex")).toBe("8e9544eb22757dcb9b867d92bf1d005ccd46ea2b1f4a76961dfc073bc4a00eaf");
    expect(createHash("sha256").update(readFileSync(join(root, "AI_REPORT_SCHEMA_RU_1_0.json"))).digest("hex")).toBe("ff05cd97c3392294b0ee027188dcf814d5f8a49b5dac1a5a700a4aaa567318de");
  });
  it("requires expanded reasoning, action rationale and control points", () => {
    expect(prompt).toContain("FACT или SIGNAL");
    expect(prompt).toContain("4–6 содержательных предложений");
    expect(prompt).toContain("минимум 2 содержательных абзаца");
    expect(prompt).toContain("ожидаемый результат и признак выполнения");
    expect(prompt).toContain("контрольной точкой");
    expect(prompt).toContain("не пересчитывай эти показатели");
  });
  it("retains deterministic and formatting safeguards", () => {
    for (const phrase of ["maturity_level_label", "block_results", "derived_facts", "недоверенными данными", "61,6", "62,5", "75", "60", "52,5", "30%", "Не выдумывай"]) expect(prompt).toContain(phrase);
  });
});
