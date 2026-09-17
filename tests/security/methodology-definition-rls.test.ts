import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260918000200_fix_methodology_definition_rls.sql", "utf8");

describe("methodology definition RLS", () => {
  it("uses a restricted security-definer lookup for published definitions", () => {
    expect(migration).toContain("private.can_read_diagnostic_definition");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public, pg_temp");
    expect(migration).toContain("v.status = 'published'");
    expect(migration).toContain("drop policy methodology_definitions_read");
  });

  it("keeps draft versions out of the definition visibility predicate", () => {
    expect(migration).not.toContain("status = 'draft'");
    expect(migration).toContain("grant execute on function private.can_read_diagnostic_definition(uuid) to authenticated");
  });
});
