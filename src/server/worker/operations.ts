import { createAdminClient } from "@/server-runtime/supabase/admin";

const kinds = ["score_diagnostic", "ai_report", "consultation_notification"] as const;

/** Read-only operational summary for a trusted runner/operations process. */
export async function getWorkerOperationalSummary() {
  const db = createAdminClient();
  const { data: rows, error } = await db.from("jobs").select("kind,status,attempts,available_at,lease_expires_at,created_at").in("kind", [...kinds]);
  if (error) throw new Error("worker_metrics_unavailable");
  const now = Date.now();
  return Object.fromEntries(kinds.map((kind) => {
    const group = (rows ?? []).filter((row) => row.kind === kind);
    const queued = group.filter((row) => row.status === "queued");
    const running = group.filter((row) => row.status === "running");
    const maxAttempts = kind === "consultation_notification" ? 5 : 3;
    const failed = group.filter((row) => row.status === "failed");
    const terminal = failed.filter((row) => Number(row.attempts) >= maxAttempts);
    const expired = running.filter((row) => row.lease_expires_at && new Date(row.lease_expires_at).getTime() <= now);
    const oldest = queued.sort((a, b) => new Date(a.available_at).getTime() - new Date(b.available_at).getTime())[0];
    return [kind, { queued: queued.length, running: running.length, retryable_failed: failed.length - terminal.length, terminal_failed: terminal.length, expired_leases: expired.length, oldest_queued_at: oldest?.available_at ?? null }];
  }));
}
