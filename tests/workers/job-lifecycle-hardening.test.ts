import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const claims = readFileSync("supabase/migrations/20260916000100_production_worker_claims.sql", "utf8");
const ai = readFileSync("src/server/ai/worker.ts", "utf8");
const runner = readFileSync("src/server/worker/runner.ts", "utf8");
const entry = readFileSync("scripts/worker.ts", "utf8");

describe("production worker lifecycle hardening", () => {
  it("uses locked, kind-scoped claims with leases and attempt ceilings", () => {
    expect(claims.toLowerCase()).toContain("for update of j skip locked");
    expect(claims).toContain("lease_expires_at <= now()");
    expect(claims).toContain("attempts < greatest(1, p_max_attempts)");
    expect(claims).toContain("j.kind = 'score_diagnostic'");
    expect(claims).toContain("j.kind = 'ai_report'");
  });
  it("terminalizes malformed AI jobs instead of defaulting to version 1", () => {
    expect(ai).toContain("invalid_ai_job_key");
    expect(ai).not.toContain("?.[1] ?? 1");
    expect(ai).toContain("ai_report_missing");
    expect(ai).toContain('new Date("2099-01-01")');
  });
  it("stops polling after SIGTERM and keeps boot failures non-zero", () => {
    expect(entry).toContain('process.once("SIGTERM", stop)');
    expect(runner).toContain("while (!state.stop)");
    expect(entry).toContain("process.exitCode = 1");
  });
});
