import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function cells(line: string) {
  const values: string[] = [];
  let value = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { values.push(value); value = ""; }
    else value += char;
  }
  values.push(value);
  return values;
}

function bank(path: string) {
  const [header, ...lines] = readFileSync(path, "utf8").trimEnd().split(/\r?\n/);
  const fields = cells(header);
  return lines.map(line => Object.fromEntries(cells(line).map((value, i) => [fields[i], value])));
}

const ru = bank("METHODOLOGY_RU_2_0.csv");
const en = bank("METHODOLOGY_EN_1_0.csv");
const migration = readFileSync("supabase/migrations/20261104153304_english_individual_methodology.sql", "utf8");

describe("English methodology preserves the published RU-2.1 assessment", () => {
  it("translates every question while retaining the exact structure and scoring metadata", () => {
    expect(en).toHaveLength(84);
    const translated = new Set(["methodology_version", "language", "block_title", "question_text", "question_type_source", "help_text"]);
    const structural = (row: Record<string, string>) => Object.fromEntries(Object.entries(row).filter(([field]) => !translated.has(field)));
    expect(en.map(structural)).toEqual(ru.map(structural));
    expect(new Set(en.map(row => row.block_code))).toHaveLength(10);
    expect(en.filter(row => row.question_weight === "1")).toHaveLength(80);
    expect(en.filter(row => row.is_required === "true")).toHaveLength(82);
    expect(en.every(row => row.language === "en" && row.question_text.trim().length > 0)).toBe(true);
    expect(en.map(row => `${row.block_title} ${row.question_text} ${row.help_text}`).join("\n")).not.toMatch(/[А-Яа-яЁё]/);
  });

  it("installs the reviewed wording against existing version 4 IDs instead of publishing a different assessment", () => {
    for (const row of en) {
      expect(migration).toContain(`('${row.question_key}','${row.question_text.replaceAll("'", "''")}',`);
    }
    expect(migration).toContain("v.version_number=4 and v.status='published'");
    expect(migration).not.toMatch(/insert into public\.(questions|diagnostic_blocks|diagnostic_versions|scoring_policies)\s*\(/);
    expect(migration).toContain("v_before is distinct from v_after");
    expect(migration).not.toMatch(/update public\.question_translations/);
  });
});
