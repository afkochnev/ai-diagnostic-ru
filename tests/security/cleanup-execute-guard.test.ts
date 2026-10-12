import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cleanup = readFileSync("scripts/cleanup-production-test-data.sql", "utf8");
const transactionStart = cleanup.indexOf("\nbegin;\n");
const executeBranch = cleanup.indexOf("\\if :_cleanup_execute\n", transactionStart);
const guard = cleanup.slice(0, transactionStart);
const container = process.env.V21R_CLEANUP_TEST_CONTAINER;

describe("production cleanup execution safety", () => {
  it("validates the flag before the cleanup transaction with errors fatal", () => {
    expect(transactionStart).toBeGreaterThan(0);
    expect(guard).toContain("\\set ON_ERROR_STOP on");
    expect(guard).toContain("\\if :{?execute}\n\\else\n  \\set execute 0\n\\endif");
    expect(guard).toContain("select :'execute' in ('0', 'false', '1') as _cleanup_execute_valid");
    expect(guard).toContain(" :'execute' = '1' as _cleanup_execute");
    expect(guard).toContain("raise exception 'execute must be exactly 0, false or 1'");
  });

  it("puts every deletion behind the parsed flag and preserves rollback", () => {
    expect(executeBranch).toBeGreaterThan(transactionStart);
    expect(cleanup.indexOf("delete from")).toBeGreaterThan(executeBranch);
    expect(cleanup.slice(transactionStart)).not.toContain("\\if :{?execute}");
    expect(cleanup).toMatch(/commit;\s*\\else\s*rollback;\s*\\endif\s*$/);

    const sql = cleanup.replace(/^--.*$/gm, "");
    expect(sql).not.toMatch(/\btruncate\b/i);
    const deletes = sql.match(/delete from[^;]+;/gi) ?? [];
    expect(deletes).toHaveLength(19);
    for (const statement of deletes) {
      expect(statement).toMatch(/\busing\b/i);
      expect(statement).toMatch(/\bwhere\b/i);
    }
  });

  it("retains exact-email targets, administrator refusal and before/after counts", () => {
    expect(cleanup).toContain("regexp_split_to_table(:'test_emails', ',')");
    expect(cleanup).toContain("join _cleanup_emails e on lower(au.email)=e.email");
    expect(cleanup).toContain("r.role='administrator'");
    expect(cleanup).toContain("raise exception 'administrator target refused'");
    expect(cleanup).toContain("raise exception 'target company has a diagnostic owned by a non-target user'");
    expect(cleanup).toContain("select 'users' entity, count(*) count from _cleanup_users");
    expect(cleanup).toContain("select 'AFTER users' entity, count(*) count from auth.users");
    expect(cleanup).toContain("select 'AFTER companies'");
    expect(cleanup).toContain("select 'AFTER diagnostics'");
  });
});

// The complete cleanup script is NEVER executed. These optional local PostgreSQL
// probes contain only its pre-transaction guard and harmless branch markers.
describe.skipIf(!container)("cleanup guard executable probes (no cleanup SQL)", () => {
  function probe(value?: string) {
    const input = `${guard}\n\\if :_cleanup_execute\nselect 'EXECUTE_BRANCH';\n\\else\nselect 'DRY_RUN';\n\\endif\n`;
    expect(input).not.toMatch(/^\s*(begin;|insert|delete|update|create|truncate)\b/im);
    const args = [
      "exec", "-i", container!, "psql", "-X", "-U", "postgres", "-d", "ai_diagnostic_v21r",
      "-q", "-t", "-A", "-v", "test_emails=guard-probe@example.invalid",
    ];
    if (value !== undefined) args.push("-v", `execute=${value}`);
    return spawnSync("docker", args, { input, encoding: "utf8", timeout: 15_000 });
  }

  it.each([undefined, "0", "false"])("%s chooses dry run", (value) => {
    const result = probe(value);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("DRY_RUN");
  });

  it("1 reaches only the harmless execution marker", () => {
    const result = probe("1");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("EXECUTE_BRANCH");
  });

  it.each(["2", "true", "", "1; delete from auth.users;"])("%s fails closed", (value) => {
    const result = probe(value);
    expect(result.status, result.stderr).toBe(3);
    expect(result.stderr).toContain("execute must be exactly 0, false or 1");
    expect(result.stdout).not.toContain("EXECUTE_BRANCH");
    expect(result.stdout).not.toContain("DRY_RUN");
  });
});
