import { createAdminClient } from "@/server-runtime/supabase/admin";
import { generateTeamReport, synthesizeTeamTexts, teamAIProvider } from "./report-provider";
import { emptyTeamCallCounts, generateTeamReportV2, synthesizeTeamTextsV2, repairSynthesisFields, repairReportFields } from "./report-v2-provider";
import { parseQualitativeInputV2 } from "./report-v2-contracts";
import { inspectSynthesisPrivacy, privacyCorpusSchema, type PrivacyCorpus } from "./synthesis-privacy";
import { validateAndRepairSynthesis } from "./synthesis-repair";
import { validateAndRepairReport } from "./report-privacy";
export type TeamJob = { id: string; kind: "team_aggregate" | "team_ai_report"; lease_token: string; attempts: number; pipeline_version?: string | null };
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export async function processTeamJob(job: TeamJob, rpc: Rpc) {
  const counts=emptyTeamCallCounts();
  let rich=false, localPass=false, storingSynthesis=false, publishing=false, reportLocalPass=false;
  let corpus: PrivacyCorpus | null=null;
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
    rich = prepared.pipeline_version === "TEAM-RU-2";
    const config = teamAIProvider(rich ? "TEAM-RU-2" : "TEAM-RU-1");
    let summary: unknown;
    if(rich) {
      const input=parseQualitativeInputV2(prepared.qualitative_input);
      corpus=privacyCorpusSchema.parse(await call("get_team_synthesis_privacy_corpus"));
      if(prepared.synthesis) {
        // A successful cached synthesis is immutable: validate, never repair/overwrite it.
        const check=inspectSynthesisPrivacy(prepared.synthesis,corpus);
        if(check.policyViolation || check.overlaps.length) throw new Error("team_privacy_rejected");
        summary=prepared.synthesis;
      } else {
        const initial=await synthesizeTeamTextsV2(input,counts);
        summary=await validateAndRepairSynthesis(initial,input,corpus,
          fields=>repairSynthesisFields(fields,counts),event=>console.info("[team-ai]",event));
      }
      localPass=true;
    } else summary=prepared.synthesis ?? await synthesizeTeamTexts(prepared.qualitative_groups);
    if (!prepared.synthesis) {
      storingSynthesis=true;
      const stored = await call("store_team_synthesis", { p_summary: summary, p_provider: config.provider, p_model: config.model });
      storingSynthesis=false;
      if (stored === "superseded") return stored;
    }
    const generated = await (rich ? generateTeamReportV2(prepared.report_input, summary,counts) : generateTeamReport(prepared.report_input, summary));
    const content=rich && corpus ? await validateAndRepairReport(generated,prepared.report_input,corpus,config.provider,
      fields=>repairReportFields(fields,counts),event=>console.info("[team-ai]",event)) : generated;
    reportLocalPass=rich;
    publishing=true;
    return await call("publish_team_report", { p_content: content, p_model: config.model });
  } catch (error) {
    // Never persist/log provider output, exception details, raw input or answer values.
    const message = error instanceof Error ? error.message : "";
    if(rich && localPass && storingSynthesis && message.includes("team_privacy_rejected")) console.info("[team-ai]",{event:"team_validator_parity_bug"});
    if(rich && reportLocalPass && publishing && message.includes("team_privacy_rejected")) console.info("[team-ai]",{event:"team_validator_parity_bug",phase:"report"});
    // A V2 job that attempted an external call cannot silently start a new synthesis
    // or repair on a later worker tick. Owner-approved explicit retry is a new run.
    const attempted=counts.synthesis_call_count+counts.repair_call_count+counts.report_call_count;
    const deterministic=["team_privacy_rejected","team_schema_rejected","team_numeric_integrity"].find(code=>message.includes(code));
    const retryable = !deterministic && (!rich || attempted===0) && /timeout|aborted|429|5\d\d|network|fetch failed|econnreset|team_aggregate_pending/i.test(message);
    const code = deterministic ?? (message==="team_aggregate_pending" ? message : retryable ? "team_provider_retryable" : "team_processing_failed");
    await rpc("fail_team_job", { ...identity, p_error_code: code, p_retryable: retryable });
    return "failed";
  } finally {
    corpus=null;
    if(rich) console.info("[team-ai]",{event:"team_ai_call_counts",...counts});
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
