import { createAdminClient } from "@/server-runtime/supabase/admin";
import { runScoringJob, type ClaimedScoringJob } from "@/server/scoring/worker";
import { runAIJob, type ClaimedAIJob } from "@/server/ai/worker";
import { runPendingConsultationNotifications } from "@/server/consultation/worker";

import { runTeamJobs } from "@/server/team/worker";

type RpcError = { message?: string; code?: string };
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>;

const numberEnv = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
};

export const workerConfig = () => ({
  pollIntervalMs: numberEnv("WORKER_POLL_INTERVAL_MS", 2000, 250, 60000),
  leaseSeconds: numberEnv("WORKER_LEASE_SECONDS", 300, 30, 3600),
  scoringMaxAttempts: numberEnv("SCORING_MAX_ATTEMPTS", 3, 1, 20),
  aiMaxAttempts: numberEnv("AI_MAX_ATTEMPTS", 3, 1, 20),
  aiConcurrency: numberEnv("AI_CONCURRENCY", 1, 1, 10),
  consultationMaxAttempts: numberEnv("CONSULTATION_MAX_ATTEMPTS", 5, 1, 20),
});

async function claim(name: string, args: Record<string, unknown>) {
  const db = createAdminClient();
  const rpc = (db as unknown as { rpc: Rpc }).rpc.bind(db);
  const result = await rpc(name, args);
  if (result.error) throw new Error(`worker_claim_failed:${result.error.code ?? "unknown"}`);
  return (result.data ?? []) as Array<Record<string, unknown>>;
}

export type WorkerSignal = { stop: boolean; signal?: AbortSignal };
export async function runWorkerOnce(state?: WorkerSignal) {
  const config = workerConfig();
  let scoringCount=0,aiCount=0;
  const stopped=()=>state?.stop===true||state?.signal?.aborted===true;
  const result=()=>({scoring:scoringCount,ai:aiCount});
  if(stopped())return result();
  const scoring = await claim("claim_scoring_jobs", { p_limit: 1, p_max_attempts: config.scoringMaxAttempts, p_lease_seconds: config.leaseSeconds });
  scoringCount=scoring.length;
  for (const job of scoring) await runScoringJob(job as unknown as ClaimedScoringJob);

  if(stopped())return result();
  const ai = await claim("claim_ai_report_jobs", { p_limit: config.aiConcurrency, p_max_attempts: config.aiMaxAttempts, p_lease_seconds: config.leaseSeconds });
  aiCount=ai.length;
  await Promise.all(ai.map((job) => runAIJob(job as unknown as ClaimedAIJob)));

  if(stopped())return result();
  await runPendingConsultationNotifications(1);
  // A Team outage cannot stop the established individual/consultation loop.
  if(stopped())return result();
  try { await runTeamJobs(); } catch { console.error("[team-worker] unavailable"); }
  return result();
}

export async function runProductionWorker(signal?: WorkerSignal) {
  const state = signal ?? { stop: false };
  while (!state.stop) {
    await runWorkerOnce(state);
    if (!state.stop&&!state.signal?.aborted) await new Promise<void>((resolve) => {
      const done=()=>{clearTimeout(timer);state.signal?.removeEventListener("abort",done);resolve();};
      const timer=setTimeout(done,workerConfig().pollIntervalMs);
      state.signal?.addEventListener("abort",done,{once:true});
      if(state.signal?.aborted)done();
    });
    if(state.signal?.aborted)state.stop=true;
  }
}
