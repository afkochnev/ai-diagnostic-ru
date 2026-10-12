import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("server-only", () => ({}));
import { selectCurrentPublishedVersion } from "@/server/diagnostic/service";

const lifecycle = readFileSync("supabase/migrations/20261012000000_allow_methodology_retirement.sql", "utf8");
const retirement = readFileSync("supabase/migrations/20261012000100_retire_invalid_methodology_v3.sql", "utf8");

describe("invalid methodology v3 retirement", () => {
  it("allows only a status-only published to retired transition while preserving immutable history", () => {
    expect(lifecycle).toContain("old.status = 'published'");
    expect(lifecycle).toContain("new.status = 'retired'");
    expect(lifecycle).toContain("(to_jsonb(new) - 'status') = (to_jsonb(old) - 'status')");
    expect(lifecycle).toContain("old.status in ('published', 'retired')");
    expect(lifecycle).toContain("v.status in ('published', 'retired')");
    expect(lifecycle).toContain("array[old.version_id, new.version_id]");
    expect(lifecycle).not.toMatch(/disable\s+trigger|drop\s+trigger|session_replication_role/i);
  });

  it("resolves logical versions, fails for missing v3 and preserves historical metadata", () => {
    expect(retirement).toContain("where key = 'manageability'");
    expect(retirement).toContain("definition_id = v_definition and version_number = 3");
    expect(retirement).toContain("definition_id = v_definition and version_number = 4");
    expect(retirement).toContain("version 3 missing; reconciliation requires investigation");
    expect(retirement).toContain("v_v3.status not in ('published', 'retired')");
    expect(retirement).toContain("where id = v_v3.id and status = 'published'");
    expect(retirement).toContain("(to_jsonb(v) - 'status') = (to_jsonb(v_v3) - 'status')");
    expect(retirement).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("asserts v4 completeness before the only status mutation", () => {
    for (const assertion of [
      "published manageability version 4 missing",
      "total blocks expected 10", "scoring blocks expected 8",
      "active scoring blocks expected 8", "active numeric scoring questions expected 80",
      "total questions expected 84", "scoring questions expected 80",
      "scoring policies expected 1", "maturity levels expected 5",
    ]) {
      expect(retirement).toContain(assertion);
      expect(retirement.indexOf(assertion)).toBeLessThan(retirement.indexOf("update public.diagnostic_versions"));
    }
    expect(retirement).toContain("current published manageability selection must be version 4");
    const mutations = retirement.match(/(?:insert\s+into|update|delete\s+from)\s+public\.[a-z_]+/gi);
    expect(mutations).toEqual(["update public.diagnostic_versions"]);
    expect(retirement).not.toMatch(/published_at\s*=|disable\s+trigger|session_replication_role/i);
  });

  it("selects v4 with retired v3 and excludes v3 when no published alternative exists", () => {
    const versions = [
      { id: "v2", definition_id: "manageability", version_number: 2, status: "published" },
      { id: "v3", definition_id: "manageability", version_number: 3, status: "retired" },
      { id: "v4", definition_id: "manageability", version_number: 4, status: "published" },
      { id: "unrelated", definition_id: "other", version_number: 9, status: "published" },
    ];
    expect(selectCurrentPublishedVersion(versions, "manageability")?.id).toBe("v4");
    expect(selectCurrentPublishedVersion([versions[1]], "manageability")).toBeNull();
    const historical = { version_id: "v3" };
    selectCurrentPublishedVersion(versions, "manageability");
    expect(historical.version_id).toBe("v3");
  });
});
