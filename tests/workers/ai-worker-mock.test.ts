import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ report: { id: "r", version: 1, status: "queued", prompt_version: "RU-1.3" }, updates: [] as Array<{ table: string; values: Record<string, unknown> }> }));
const generate = vi.hoisted(() => vi.fn());
vi.mock("@/server/ai/report", () => ({ buildAIInput: vi.fn(async () => ({ fixture: true })), generateReport: generate }));
vi.mock("@/server-runtime/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    maybeSingle: async () => table === "ai_reports" ? { data: state.report } : { data: null },
    update: (values: unknown) => { state.updates.push({ table, values: values as Record<string, unknown> }); return chain; },
  };
  return chain;
} }) }));

describe("Stage 9C AI worker mock provider", () => {
  beforeEach(() => {
    state.updates.length = 0;
    state.report = { id: "r", version: 1, status: "queued", prompt_version: "RU-1.3" };
    generate.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());
  const job = { job_id: "j", diagnostic_id: "d", lease_token: "lease", attempt_count: 1, deduplication_key: "ai_report_v1" };
  it("persists a completed report on provider success", async () => {
    generate.mockResolvedValue({ content: { summary: "ok" }, requestId: "mock" });
    const { runAIJob } = await import("@/server/ai/worker");
    expect(await runAIJob(job)).toEqual({ status: "completed" });
    expect(state.updates.some((x) => x.table === "ai_reports" && x.values.status === "completed")).toBe(true);
    expect(state.updates.some((x) => x.table === "jobs" && x.values.status === "completed")).toBe(true);
  });
  it.each(["timeout", "429 rate limit", "provider 503", "invalid structured output"])("handles mocked %s failure without provider call", async (message) => {
    generate.mockRejectedValue(new Error(message));
    const { runAIJob } = await import("@/server/ai/worker");
    expect(await runAIJob(job)).toEqual({ status: "failed" });
    const expectedReportStatus = message === "invalid structured output" ? "failed" : "queued";
    expect(state.updates).toContainEqual({ table: "ai_reports", values: {
      status: expectedReportStatus,
      error_code: expectedReportStatus === "failed" ? "ai_failed" : null,
      error_message: expectedReportStatus === "failed" ? "AI report generation failed" : null,
    } });
  });

  it.each([1, 3, 5])("reports a terminal timeout after %i configured attempts", async maxAttempts => {
    generate.mockRejectedValue(new Error("provider timeout: synthetic detail"));
    const { runAIJob } = await import("@/server/ai/worker");
    expect(await runAIJob({ ...job, attempt_count: maxAttempts }, maxAttempts)).toEqual({ status: "failed" });
    expect(state.updates).toContainEqual({ table: "ai_reports", values: {
      status: "failed", error_code: "provider_retryable", error_message: "AI report generation failed",
    } });
  });

  it("records each failed attempt even after a successful retry clears the stored code", async () => {
    generate.mockRejectedValueOnce(new Error("provider timeout: sensitive detail"))
      .mockRejectedValueOnce(new Error("provider 503: sensitive detail"))
      .mockResolvedValueOnce({ content: { summary: "ok" } });
    const { runAIJob } = await import("@/server/ai/worker");
    await runAIJob(job);
    await runAIJob({ ...job, attempt_count: 2 });
    expect(await runAIJob({ ...job, attempt_count: 3 })).toEqual({ status: "completed" });
    const calls = vi.mocked(console.warn).mock.calls;
    expect(calls.map(([tag, payload]) => [tag, JSON.parse(payload)])).toEqual([1, 2].map(attempt => [
      "[report-worker]", {
        event: "report_attempt_failed", kind: "individual", job_id: "j", attempt,
        code: "provider_retryable", phase: "generate_report", retry_requested: true,
      },
    ]));
  });
});
