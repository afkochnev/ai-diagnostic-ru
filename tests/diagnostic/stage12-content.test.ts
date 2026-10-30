import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260918000100_methodology_ru_2_0.sql", "utf8");
const runner = readFileSync("src/features/diagnostic/diagnostic-runner.tsx", "utf8");

describe("Stage 12.1 content compatibility", () => {
  it("publishes a new version and leaves RU-1.0 rows untouched", () => {
    expect(migration).toMatch(/values\s*\(v_version\s*,\s*v_definition\s*,\s*2/);
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

  it("keeps a visible saved or unsaved state and persistent save errors", () => {
    expect(runner).toContain('setSaving("saving")');
    expect(runner).toContain('setSaving("unsaved")');
    expect(runner).toContain('setSaving(answersHash(answersRef.current) === currentHash ? "saved" : "unsaved")');
    expect(runner).toContain('"Все ответы сохранены"');
    expect(runner).toContain('"Есть несохранённые ответы…"');
    expect(runner).toContain('setSaving("error")');
    expect(runner).toContain('"Ошибка сохранения"');
    expect(runner).not.toContain('setTimeout(() => { setSaving("idle")');
  });
});
