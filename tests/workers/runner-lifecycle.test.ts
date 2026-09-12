import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn(async (name: string) => ({ data: name === "claim_scoring_jobs" ? [{ job_id: "s", diagnostic_id: "d", lease_token: "ls", attempt_count: 1 }] : name === "claim_ai_report_jobs" ? [{ job_id: "a", diagnostic_id: "d", lease_token: "la", attempt_count: 1, deduplication_key: "ai_report_v1" }] : [], error: null }));
const scoring = vi.fn(async () => ({ status: "completed" }));
const ai = vi.fn(async () => ({ status: "completed" }));
const consultation = vi.fn(async () => ({ claimed: 0, results: [] }));

vi.mock("@/server-runtime/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/server/scoring/worker", () => ({ runScoringJob: scoring }));
vi.mock("@/server/ai/worker", () => ({ runAIJob: ai }));
vi.mock("@/server/consultation/worker", () => ({ runPendingConsultationNotifications: consultation }));

describe("Stage 9C runner lifecycle", () => {
  beforeEach(() => { vi.clearAllMocks(); });
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
});
