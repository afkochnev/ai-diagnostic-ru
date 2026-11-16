import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type ClaimResponse = { data: unknown[] | null; error: { code?: string; message?: string } | null; status: number };
const success = async (name: string): Promise<ClaimResponse> => ({
  data: name === "claim_scoring_jobs"
    ? [{ job_id: "s", diagnostic_id: "d", lease_token: "ls", attempt_count: 1 }]
    : name === "claim_ai_report_jobs"
      ? [{ job_id: "a", diagnostic_id: "d", lease_token: "la", attempt_count: 1, deduplication_key: "ai_report_v1" }]
      : [],
  error: null,
  status: 200,
});
const rpc = vi.fn(success);
const scoring = vi.fn(async () => ({ status: "completed" }));
const ai = vi.fn(async () => ({ status: "completed" }));
const consultation = vi.fn(async () => ({ claimed: 0, results: [] as { status: string }[] }));
const team = vi.fn(async () => {});

vi.mock("@/server-runtime/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/server/scoring/worker", () => ({ runScoringJob: scoring }));
vi.mock("@/server/ai/worker", () => ({ runAIJob: ai }));
vi.mock("@/server/consultation/worker", () => ({ runPendingConsultationNotifications: consultation }));
vi.mock("@/server/team/worker", () => ({ runTeamJobs: team }));

describe("Stage 9C runner lifecycle", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });
  it("claims and dispatches all supported kinds", async () => {
    const { runWorkerOnce } = await import("@/server/worker/runner");
    await runWorkerOnce();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(scoring).toHaveBeenCalledOnce();
    expect(ai).toHaveBeenCalledOnce();
    expect(consultation).toHaveBeenCalledOnce();
  });
  it("honours a stop signal without polling", async () => {
    const { runProductionWorker } = await import("@/server/worker/runner");
    const state = { stop: true };
    await runProductionWorker(state);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("continues Team work when the consultation claim receives HTTP 555 and retries on the next poll", async () => {
    const { runWorkerOnce } = await import("@/server/worker/runner");
    const original = await vi.importActual<typeof import("@/server/consultation/worker")>("@/server/consultation/worker");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    consultation
      .mockImplementationOnce(() => original.runPendingConsultationNotifications(1))
      .mockImplementationOnce(() => original.runPendingConsultationNotifications(1));
    rpc.mockImplementationOnce(success).mockImplementationOnce(success).mockResolvedValueOnce({
      data: null, status: 555, error: { message: "untrusted error details" },
    });

    await expect(runWorkerOnce()).resolves.toEqual({ scoring: 1, ai: 1 });
    expect(team).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("[worker] queue_claim_deferred", { queue: "consultation", code: undefined, status: 555 });
    expect(JSON.stringify(error.mock.calls)).not.toContain("untrusted error details");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["claim_scoring_jobs", "claim_ai_report_jobs", "claim_consultation_notification_jobs"]);
    await expect(runWorkerOnce()).resolves.toEqual({ scoring: 1, ai: 1 });
    expect(team).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(6, "claim_consultation_notification_jobs", expect.any(Object));
  });
  it("leaves an interrupted scoring claim for the next poll and continues the other queues", async () => {
    const { runWorkerOnce } = await import("@/server/worker/runner");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, status: 0, error: { message: "TypeError: fetch failed" } });

    await expect(runWorkerOnce()).resolves.toEqual({ scoring: 0, ai: 1 });
    expect(scoring).not.toHaveBeenCalled();
    expect(ai).toHaveBeenCalledOnce();
    expect(consultation).toHaveBeenCalledOnce();
    expect(team).toHaveBeenCalledOnce();
    await expect(runWorkerOnce()).resolves.toEqual({ scoring: 1, ai: 1 });
    expect(scoring).toHaveBeenCalledOnce();
  });
  it("propagates a permanent claim error without reclassifying it as transient", async () => {
    const { runWorkerOnce } = await import("@/server/worker/runner");
    rpc.mockResolvedValueOnce({ data: null, status: 500, error: { code: "42501" } });

    await expect(runWorkerOnce()).rejects.toThrow("scoring_claim_failed:42501");
    expect(rpc).toHaveBeenCalledOnce();
    expect(scoring).not.toHaveBeenCalled();
    expect(team).not.toHaveBeenCalled();
  });
});
