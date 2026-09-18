import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260918000400_repair_methodology_versions.sql", "utf8");
const ru21 = "В распределении функций и ответственности между подразделениями нет существенного дублирования и «белых пятен», за которые фактически никто не отвечает.";

describe("production methodology repair migration", () => {
  it("uses environment-independent logical lookups and never staging UUIDs", () => {
    expect(migration).toContain("where key='manageability'");
    expect(migration).toContain("version_number=1");
    expect(migration).toContain("version_number=2");
    expect(migration).not.toContain("c5d7b1d0-1f4f-4e93-8af6-12b7d0e2f201");
    expect(migration).not.toContain("656e05fd-66c4-50bf-908f-53565525dd5a");
  });

  it("builds draft versions, asserts complete content, then publishes", () => {
    expect(migration).toContain("2,'draft'");
    expect(migration).toContain("4,'draft'");
    expect(migration).toContain("RU-2.0 scoring blocks expected 8");
    expect(migration).toContain("RU-2.0 scoring questions expected 80");
    expect(migration).toContain("RU-2.1 content counts invalid");
    expect(migration.indexOf("'draft'")) .toBeLessThan(migration.lastIndexOf("status='published'"));
  });

  it("repairs missing maturity children from logical RU-1.0 lookup", () => {
    expect(migration).toContain("where version_id=v_v1");
    expect(migration).toContain("RU-1.0 maturity levels expected 5");
    expect(migration).toContain("if v_maturity_count=0 then");
    expect(migration).toContain("RU-2.0 maturity levels expected 5");
    expect(migration).toContain("RU-2.1 scoring metadata incomplete");
  });

  it("preserves the failed v3 and applies exactly the approved RU-2.1 correction", () => {
    expect(migration).not.toMatch(/version_number=3/);
    expect(migration).toContain(ru21);
    expect(migration).toContain("b.key='structure'");
    expect(migration).toContain("q.position=3");
  });
});
