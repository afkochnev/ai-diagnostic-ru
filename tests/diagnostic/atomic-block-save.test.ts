import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("src/server/diagnostic/service.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260917000100_atomic_diagnostic_answer_save.sql", "utf8");

describe("atomic diagnostic block save", () => {
  it("uses one authenticated RPC instead of per-answer network writes", () => {
    expect(service).toContain('client.rpc("save_diagnostic_block"');
    expect(service).not.toContain('client.from("answers").upsert');
    expect(service).not.toContain('client.from("answers").delete');
  });

  it("keeps ownership, revision, idempotency and set-based writes in one function", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("d.created_by_user_id = v_actor");
    expect(migration).toContain("for update");
    expect(migration).toContain("diagnostic_mutations");
    expect(migration).toContain("on conflict (diagnostic_id, question_id) do update");
    expect(migration).toContain("delete from public.answers");
    expect(migration).toContain("raise exception 'conflict'");
  });
});
