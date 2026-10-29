import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const prompt = readFileSync("AI_REPORT_PROMPT_RU_1_5.md", "utf8");
const schema = JSON.parse(readFileSync("AI_REPORT_SCHEMA_RU_1_0.json", "utf8"));

describe("RU-1.5 human-language editorial contract", () => {
  it("keeps list guidance inside the report schema bounds", () => {
    expect(prompt).toContain("2–4 пункта — в пределах JSON-схемы");
    expect(prompt).toContain("3–5 пунктов");
    expect(schema.properties.strengths.minItems).toBe(2);
    expect(schema.properties.strengths.maxItems).toBe(4);
    expect(schema.properties.key_problem_zones.minItems).toBe(2);
    expect(schema.properties.key_problem_zones.maxItems).toBe(4);
    expect(schema.properties.implementation_risks.minItems).toBe(3);
    expect(schema.properties.implementation_risks.maxItems).toBe(5);
    expect(schema.properties.first_actions.minItems).toBe(3);
    expect(schema.properties.first_actions.maxItems).toBe(5);
  });

  it("explicitly rejects the telegraphic patterns seen in prior reports", () => {
    for (const text of [
      "не как заполненная AI-форма",
      "Не используй в пользовательском тексте символические цепочки",
      "Ожидаемый результат — ...",
      "Контрольная точка — ...",
      "Лучше три содержательных шага, чем семь искусственно раздробленных",
      "пригоден для чтения вслух",
    ]) expect(prompt).toContain(text);
  });

  it("keeps factual caution while improving prose", () => {
    expect(prompt).toContain("заявленные пользователем сведения");
    expect(prompt).toContain("Не превращай высокий балл автоматически в доказанный факт о реальной способности компании");
    expect(prompt).toContain("Если причинная связь является выводом");
  });
});
