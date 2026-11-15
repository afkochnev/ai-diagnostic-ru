import crypto from "node:crypto";
import {assertFreeSmokeDiagnostic} from "@/server-runtime/free-smoke";
import { createAdminClient } from "@/server-runtime/supabase/admin";
import { buildAIInput, generateReport } from "./report";
import {
  assertIndividualPromptVersion, individualPromptForMethodology, RU_V3_INDIVIDUAL_INPUT_VERSION, RU_V3_INDIVIDUAL_PROMPT_VERSION,
} from "./prompt-version";
export async function enqueueAIReport(diagnosticId: string, version = 1) {
  const db = createAdminClient();
  const deduplicationKey = `ai_report_v${version}`;
  async function readReport() {
    const { data, error } = await db.from("ai_reports").select("id,version,status")
      .eq("diagnostic_id", diagnosticId).eq("version", version).maybeSingle();
    if (error) throw new Error("ai_report_read_failed");
    return data;
  }

  let report = await readReport();
  if (!report) {
    const { data: diagnostic, error: diagnosticError } = await db.from("diagnostics")
      .select("methodology:diagnostic_versions!diagnostics_version_id_fkey!inner(version_number,definition:diagnostic_definitions!inner(key))").eq("id", diagnosticId).single();
    const methodology = diagnostic?.methodology as unknown as { version_number: number; definition: { key: string } } | undefined;
    if (diagnosticError || !methodology?.definition) throw Error("ai_methodology_missing");
    const promptVersion = individualPromptForMethodology(methodology.definition.key, methodology.version_number);
    const input = await buildAIInput(diagnosticId, promptVersion);
    const hash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const { data, error } = await db.from("ai_reports").insert({ diagnostic_id: diagnosticId, version, prompt_version: promptVersion, schema_version: "RU-1.0", model: process.env.OPENAI_MODEL || "gpt-5.6-sol", status: "queued", input_snapshot: input, input_hash: hash }).select("id,version,status").single();
    report = error?.code === "23505" ? await readReport() : data;
    if (!report || (error && error.code !== "23505")) throw new Error("ai_report_insert_failed");
  }
  if (report.status !== "queued") return report;

  // A previous attempt may have persisted the report and lost the job write.
  // A duplicate must leave an existing job's lease, attempts and status alone.
  const { error: jobError } = await db.from("jobs").upsert(
    { kind: "ai_report", diagnostic_id: diagnosticId, deduplication_key: deduplicationKey },
    { onConflict: "kind,diagnostic_id,deduplication_key", ignoreDuplicates: true },
  );
  if (jobError) throw new Error("ai_job_enqueue_failed");
  return report;
}

export type ClaimedAIJob = { job_id: string; diagnostic_id: string; lease_token: string; attempt_count: number; deduplication_key: string };
export function isRetryableAIError(message: string) { return /timeout|aborted|429|rate.?limit|5\d\d|network|fetch failed|econnreset/i.test(message); }

export async function runAIJob(job: ClaimedAIJob, maxAttempts = 3) {
  assertFreeSmokeDiagnostic(job.diagnostic_id);
  const db = createAdminClient();
  const diagnosticId = job.diagnostic_id;
  const lease = job.lease_token;
  const versionMatch = job.deduplication_key.match(/^ai_report_v(\d+)$/);
  if (!versionMatch) {
    await db.from("jobs").update({ status: "failed", available_at: new Date("2099-01-01").toISOString(), attempts: maxAttempts, last_error_code: "invalid_ai_job_key", last_error_message: "AI job payload is invalid", lease_token: null, lease_expires_at: null }).eq("id", job.job_id).eq("lease_token", job.lease_token);
    return { status: "failed" };
  }
  const version = Number(versionMatch[1]);
  const { data: report } = await db.from("ai_reports").select("id,version,status,prompt_version,input_snapshot").eq("diagnostic_id", diagnosticId).eq("version", version).maybeSingle();
  if (!report) {
    await db.from("jobs").update({ status: "failed", available_at: new Date("2099-01-01").toISOString(), attempts: maxAttempts, last_error_code: "ai_report_missing", last_error_message: "AI report row is missing", lease_token: null, lease_expires_at: null }).eq("id", job.job_id).eq("lease_token", lease);
    return { status: "failed" };
  }
  if (report.status === "completed") {
    await db.from("jobs").update({ status: "completed", completed_at: new Date().toISOString(), lease_token: null, lease_expires_at: null }).eq("id", job.job_id).eq("lease_token", lease);
    return { status: "completed" };
  }
  await db.from("ai_reports").update({ status: "generating" }).eq("id", report.id).in("status", ["queued", "failed", "generating"]);
  try {
    assertIndividualPromptVersion(report.prompt_version);
    const input = report.prompt_version === RU_V3_INDIVIDUAL_PROMPT_VERSION
      ? report.input_snapshot
      : await buildAIInput(diagnosticId, report.prompt_version);
    if (report.prompt_version === RU_V3_INDIVIDUAL_PROMPT_VERSION && input?.input_version !== RU_V3_INDIVIDUAL_INPUT_VERSION) {
      throw Error("invalid_individual_input_version");
    }
    const generated = await generateReport(input, report.prompt_version, Number(process.env.AI_PROVIDER_TIMEOUT_MS || 180000),diagnosticId);
    const { error: reportError } = await db.from("ai_reports").update({ status: "completed", structured_content: generated.content, provider_request_id: generated.requestId ?? null, completed_at: new Date().toISOString(), error_code: null, error_message: null }).eq("id", report.id).eq("status", "generating");
    if (reportError) throw new Error(`ai_report_persist_failed:${reportError.message}`);
    const { error: jobError } = await db.from("jobs").update({ status: "completed", completed_at: new Date().toISOString(), lease_token: null, lease_expires_at: null, last_error_code: null, last_error_message: null }).eq("id", job.job_id).eq("lease_token", lease);
    if (jobError) throw new Error(`ai_job_complete_failed:${jobError.message}`);
    return { status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const retryable = isRetryableAIError(message);
    const terminal = !retryable || job.attempt_count >= maxAttempts;
    const next = new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.max(0, job.attempt_count - 1))).toISOString();
    const errorCode = ["invalid_individual_prompt_version", "invalid_individual_input_version"].includes(message)
      ? message : retryable ? "provider_retryable" : "ai_failed";
    await db.from("ai_reports").update({
      status: terminal ? "failed" : "queued", error_code: terminal ? errorCode : null,
      error_message: terminal ? "AI report generation failed" : null,
    }).eq("id", report.id).eq("status", "generating");
    await db.from("jobs").update({ status: "failed", available_at: terminal ? new Date("2099-01-01").toISOString() : next, attempts: terminal ? maxAttempts : job.attempt_count, last_error_code: errorCode, last_error_message: "AI report generation failed", lease_token: null, lease_expires_at: null }).eq("id", job.job_id).eq("lease_token", lease);
    return { status: "failed" };
  }
}
