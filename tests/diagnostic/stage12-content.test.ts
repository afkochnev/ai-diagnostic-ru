import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260918000100_methodology_ru_2_0.sql", "utf8");
const runner = readFileSync("src/features/diagnostic/diagnostic-runner.tsx", "utf8");

describe("Stage 12.1 content compatibility", () => {
  it("publishes a new version and leaves RU-1.0 rows untouched", () => {
    expect(migration).toContain("version_number,2");
    expect(migration).toContain("v_old_version");
    expect(migration).toContain("Инновации и развитие");
    expect(migration).toContain("Процессы и операционная эффективность");
    expect(migration).toContain("Зрелость команды");
  });

  it("contains the approved open question and preserves 1..5 option bank", () => {
    expect(migration).toContain("Какую главную управленческую проблему Вы хотите решить в ближайшие 3–6 месяцев?");
    expect(migration).toContain("question_options");
    expect(migration).toContain("score_value");
  });

  it("shows transient save success and keeps save errors persistent", () => {
    expect(runner).toContain('setSaving("saving")');
    expect(runner).toContain('setSaving("saved")');
    expect(runner).toContain('setTimeout(() => { setSaving("idle")');
    expect(runner).toContain('setSaving("error")');
  });
});
