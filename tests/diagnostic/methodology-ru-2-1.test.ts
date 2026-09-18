import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260918000300_methodology_ru_2_1.sql", "utf8");
const newPrompt = "В распределении функций и ответственности между подразделениями нет существенного дублирования и «белых пятен», за которые фактически никто не отвечает.";

describe("RU-2.1 methodology migration", () => {
  it("assembles version 3 as draft before publishing", () => {
    expect(migration).toContain("v_version uuid := 'd6e8c2e1-2f50-4f94-9b07-23c8d1f3a312'");
    expect(migration).toContain("v_version, v_definition, 3, 'draft'");
    expect(migration).toContain("set status = 'published', published_at = now()");
    expect(migration.indexOf("'draft'")).toBeLessThan(migration.indexOf("set status = 'published'"));
  });

  it("changes only the required RU-2.1 prompt", () => {
    expect(migration).toContain(newPrompt);
    expect(migration).toContain("b.key = 'structure'");
    expect(migration).toContain("q.position = 3");
    expect(migration).not.toContain("update public.question_translations t set prompt='В распределении функций и ответственности между подразделениями нет существенных дублирований");
  });
});
