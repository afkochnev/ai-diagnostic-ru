import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const foundation = readFileSync("supabase/migrations/20261013000100_account_foundation.sql", "utf8");
const cutover = readFileSync("supabase/migrations/20261013000200_account_authorization_cutover.sql", "utf8");
const source = `${foundation}\n${cutover}`;

// Actual backfill/constraints/RLS are tested by test-account-foundation-local.py.
// These guards cover the scope boundaries that must remain stable in this stage.
describe("account migration scope boundaries", () => {
  it("adds only the approved account tables", () => {
    const tables = [...source.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_]+)/gi)]
      .map((match) => match[1]).sort();
    expect(tables).toEqual(["account_memberships", "accounts"]);
    expect(source).not.toMatch(/create\s+table\s+(?:public|private)\.(?:participants|participant_answers|team_[a-z_]+|billing_[a-z_]+|subscriptions|plans|entitlements)/i);
  });

  it("does not mutate methodology content or migration ledgers", () => {
    expect(source).not.toMatch(/(?:insert\s+into|update|delete\s+from)\s+public\.(?:diagnostic_versions|diagnostic_blocks|questions|question_options|scoring_policies|maturity_levels)\b/i);
    expect(source).not.toMatch(/(?:insert\s+into|update|delete\s+from|alter\s+table)\s+supabase_migrations\./i);
    expect(source).not.toMatch(/disable\s+trigger|session_replication_role/i);
  });

  it("uses random account identifiers and protects the legacy mapping", () => {
    expect(foundation).toMatch(/id\s+uuid\s+primary\s+key\s+default\s+(?:public\.)?gen_random_uuid\(\)/i);
    expect(foundation).toContain("legacy_origin_user_id");
    expect(foundation).toMatch(/unique\s*\(\s*legacy_origin_user_id\s*\)|legacy_origin_user_id\s+uuid[^;]+\bunique\b/i);
    expect(foundation).toContain("ensure_legacy_account");
  });

  it("keeps destructive table removal and trigger bypass outside this stage", () => {
    expect(source).not.toMatch(/drop\s+table|truncate\s+(?:table\s+)?(?:public|private)\./i);
    expect(source).toMatch(/enable\s+row\s+level\s+security/i);
    expect(source).toContain("can_access_account");
    expect(source).toContain("can_access_company");
    expect(source).toContain("can_access_diagnostic");
  });
});
