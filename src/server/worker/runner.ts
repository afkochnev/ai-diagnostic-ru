import { createAdminClient } from "@/server-runtime/supabase/admin";
import { runScoringJob, type ClaimedScoringJob } from "@/server/scoring/worker";
import { runAIJob, type ClaimedAIJob } from "@/server/ai/worker";
import { runPendingConsultationNotifications } from "@/server/consultation/worker";

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

export async function runWorkerOnce() {
  const config = workerConfig();
  const scoring = await claim("claim_scoring_jobs", { p_limit: 1, p_max_attempts: config.scoringMaxAttempts, p_lease_seconds: config.leaseSeconds });
  for (const job of scoring) await runScoringJob(job as unknown as ClaimedScoringJob);

  const ai = await claim("claim_ai_report_jobs", { p_limit: config.aiConcurrency, p_max_attempts: config.aiMaxAttempts, p_lease_seconds: config.leaseSeconds });
  await Promise.all(ai.map((job) => runAIJob(job as unknown as ClaimedAIJob)));

  await runPendingConsultationNotifications(1);
  return { scoring: scoring.length, ai: ai.length };
}

export async function runProductionWorker(signal?: { stop: boolean }) {
  const state = signal ?? { stop: false };
  while (!state.stop) {
    await runWorkerOnce();
    if (!state.stop) await new Promise((resolve) => setTimeout(resolve, workerConfig().pollIntervalMs));
  }
}
