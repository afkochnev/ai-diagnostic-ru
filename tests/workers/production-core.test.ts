import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isRetryableAIError } from "@/server/ai/worker";

const migration = readFileSync("supabase/migrations/20260916000100_production_worker_claims.sql", "utf8");
const runner = readFileSync("src/server/worker/runner.ts", "utf8");
const scoring = readFileSync("src/server/scoring/worker.ts", "utf8");
const ai = readFileSync("src/server/ai/worker.ts", "utf8");
const route = readFileSync("src/app/api/diagnostics/[diagnosticId]/score/route.ts", "utf8");

describe("Stage 9C production worker core", () => {
  it("claims scoring and AI jobs atomically by kind", () => {
    expect(migration).toContain("claim_scoring_jobs");
    expect(migration).toContain("claim_ai_report_jobs");
    expect(migration.match(/for update of j skip locked/g)?.length).toBe(2);
    expect(migration).toContain("j.kind = 'score_diagnostic'");
    expect(migration).toContain("j.kind = 'ai_report'");
    expect(migration).toContain("j.lease_expires_at <= now()");
    expect(migration).toContain("j.attempts < greatest(1, p_max_attempts)");
    expect(migration).toContain("on conflict (kind, diagnostic_id, deduplication_key)");
  });
  it("uses explicit claim identity and fenced completion", () => {
    expect(scoring).toContain("lease_token");
    expect(scoring).toContain('eq("id",jobId).eq("lease_token",lease)');
    expect(ai).toContain("deduplication_key");
    expect(ai).toContain('eq("id", job.job_id).eq("lease_token", lease)');
  });
  it("keeps browser scoring endpoint read-only", () => {
    expect(route).not.toContain('import { runScoringJob }');
    expect(route).toContain("status: diagnostic.status === \"submitted\" ? \"queued\"");
  });
  it("provides a single polling runner and bounded defaults", () => {
    expect(runner).toContain("runPendingConsultationNotifications");
    expect(runner).toContain("WORKER_POLL_INTERVAL_MS");
    expect(runner).toContain("SCORING_MAX_ATTEMPTS");
    expect(runner).toContain("AI_MAX_ATTEMPTS");
  });
  it("classifies provider failures for bounded retries", () => {
    expect(isRetryableAIError("request timeout")).toBe(true);
    expect(isRetryableAIError("provider 429 rate limit")).toBe(true);
    expect(isRetryableAIError("provider 503")).toBe(true);
    expect(isRetryableAIError("invalid structured output")).toBe(false);
  });
});
