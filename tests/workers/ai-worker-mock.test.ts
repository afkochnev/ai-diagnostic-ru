import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ report: { id: "r", version: 1, status: "queued" }, updates: [] as Array<{ table: string; values: Record<string, unknown> }> }));
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
  beforeEach(() => { state.updates.length = 0; state.report = { id: "r", version: 1, status: "queued" }; generate.mockReset(); });
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
    expect(state.updates.some((x) => x.table === "ai_reports" && x.values.status === "failed")).toBe(true);
  });
});
