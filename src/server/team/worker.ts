import { createAdminClient } from "@/server-runtime/supabase/admin";
import { generateTeamReport, synthesizeTeamTexts, teamAIProvider } from "./report-provider";
import { generateTeamReportV2, synthesizeTeamTextsV2 } from "./report-v2-provider";
export type TeamJob = { id: string; kind: "team_aggregate" | "team_ai_report"; lease_token: string; attempts: number; pipeline_version?: string | null };
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export async function processTeamJob(job: TeamJob, rpc: Rpc) {
  const identity = { p_job_id: job.id, p_lease_token: job.lease_token };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await rpc(name, { ...identity, ...args });
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  try {
    if (job.kind === "team_aggregate") return await call("process_team_aggregate");
    const prepared = await call("prepare_team_report_job") as { status: string; pipeline_version?: string; qualitative_groups?: unknown; qualitative_input?: unknown; report_input?: unknown; synthesis?: unknown };
    if (prepared.status !== "generating") return prepared.status;
    const rich = prepared.pipeline_version === "TEAM-RU-2";
    const config = teamAIProvider(rich ? "TEAM-RU-2" : "TEAM-RU-1");
    const summary = prepared.synthesis ?? await (rich ? synthesizeTeamTextsV2(prepared.qualitative_input) : synthesizeTeamTexts(prepared.qualitative_groups));
    if (!prepared.synthesis) {
      const stored = await call("store_team_synthesis", { p_summary: summary, p_provider: config.provider, p_model: config.model });
      if (stored === "superseded") return stored;
    }
    const content = await (rich ? generateTeamReportV2(prepared.report_input, summary) : generateTeamReport(prepared.report_input, summary));
    return await call("publish_team_report", { p_content: content, p_model: config.model });
  } catch (error) {
    // Never persist/log provider output, exception details, raw input or answer values.
    const message = error instanceof Error ? error.message : "";
    const retryable = /timeout|aborted|429|5\d\d|network|fetch failed|econnreset|team_aggregate_pending/i.test(message);
    const code = ["team_privacy_rejected","team_schema_rejected","team_numeric_integrity","team_aggregate_pending"].includes(message) ? message : retryable ? "team_provider_retryable" : "team_processing_failed";
    await rpc("fail_team_job", { ...identity, p_error_code: code, p_retryable: retryable });
    return "failed";
  }
}
export async function runTeamJobs() {
  // Production stays disabled. Team provider defaults to mock independently of legacy AI.
  if (process.env.APP_URL !== "https://ai-diagnostic-staging-web.onrender.com" || process.env.SUPABASE_URL !== "https://vflgxgdwlftlyjslyrmo.supabase.co") return 0;
  const db = createAdminClient();
  const rpc: Rpc = async (name,args) => { const r = await db.rpc(name,args); return { data: r.data, error: r.error }; };
  const { data, error } = await rpc("claim_team_jobs_v2", { p_limit: 1, p_lease_seconds: 600 });
  if (error) throw new Error("team_claim_failed");
  const jobs = (data ?? []) as TeamJob[];
  for (const job of jobs) await processTeamJob(job, rpc);
  return jobs.length;
}
