import crypto from "node:crypto";
import { createAdminClient } from "@/server-runtime/supabase/admin";
import { buildAIInput, generateReport } from "./report";
export async function enqueueAIReport(diagnosticId: string, version = 1) {
  const db = createAdminClient();
  const input = await buildAIInput(diagnosticId);
  const hash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const promptVersion = version === 1 ? "RU-1.0" : version === 2 ? "RU-1.1" : "RU-1.2";
  const deduplicationKey = `ai_report_v${version}`;
  const { data: existing } = await db.from("ai_reports").select("id,version,status").eq("diagnostic_id", diagnosticId).eq("version", version).maybeSingle();
  if (existing) return existing;
  const { data: report, error } = await db.from("ai_reports").insert({ diagnostic_id: diagnosticId, version, prompt_version: promptVersion, schema_version: "RU-1.0", model: process.env.OPENAI_MODEL || "gpt-5.6-sol", status: "queued", input_snapshot: input, input_hash: hash }).select("id,version,status").single();
  if (error || !report) {
    if (error?.code === "23505") {
      const { data: existingReport } = await db.from("ai_reports").select("id,version,status").eq("diagnostic_id", diagnosticId).eq("version", version).maybeSingle();
      if (existingReport) return existingReport;
    }
    throw error ?? new Error("ai_report_insert_failed");
  }
  const { error: jobError } = await db.from("jobs").insert({ kind: "ai_report", diagnostic_id: diagnosticId, deduplication_key: deduplicationKey });
  if (jobError?.code === "23505") return report;
  if (jobError) throw jobError;
  return report;
}

export async function requestAIReportRegeneration(userId: string, diagnosticId: string) {
  const db = createAdminClient();
  const { data: diagnostic } = await db.from("diagnostics").select("id,status,created_by_user_id").eq("id", diagnosticId).eq("created_by_user_id", userId).maybeSingle();
  if (!diagnostic || diagnostic.status !== "completed") throw new Error("not_found");
  const { data: result } = await db.from("diagnostic_results").select("id").eq("diagnostic_id", diagnosticId).maybeSingle();
  if (!result) throw new Error("not_found");
  const { data: reports } = await db.from("ai_reports").select("id,version,status").eq("diagnostic_id", diagnosticId).order("version", { ascending: false });
  const current = reports ?? [];
  const active = current.find((report) => report.status === "queued" || report.status === "generating");
  if (active) return active;
  const nextVersion = (current[0]?.version ?? 0) + 1;
  return enqueueAIReport(diagnosticId, nextVersion);
}

export type ClaimedAIJob = { job_id: string; diagnostic_id: string; lease_token: string; attempt_count: number; deduplication_key: string };
export function isRetryableAIError(message: string) { return /timeout|aborted|429|rate.?limit|5\d\d|network|fetch failed|econnreset/i.test(message); }

export async function runAIJob(job: ClaimedAIJob) {
  const db = createAdminClient();
  const diagnosticId = job.diagnostic_id;
  const version = Number(job.deduplication_key.match(/^ai_report_v(\d+)$/)?.[1] ?? 1);
  const { data: report } = await db.from("ai_reports").select("id,version,status").eq("diagnostic_id", diagnosticId).eq("version", version).maybeSingle();
  if (!report) return { status: "missing" };
  const lease = job.lease_token;
  if (report.status === "completed") {
    await db.from("jobs").update({ status: "completed", completed_at: new Date().toISOString(), lease_token: null, lease_expires_at: null }).eq("id", job.job_id).eq("lease_token", lease);
    return { status: "completed" };
  }
  await db.from("ai_reports").update({ status: "generating" }).eq("id", report.id).in("status", ["queued", "failed", "generating"]);
  try {
    const input = await buildAIInput(diagnosticId);
    const generated = await generateReport(input, report.version === 1 ? "RU-1.0" : report.version === 2 ? "RU-1.1" : "RU-1.2", Number(process.env.AI_PROVIDER_TIMEOUT_MS || 180000));
    const { error: reportError } = await db.from("ai_reports").update({ status: "completed", structured_content: generated.content, provider_request_id: generated.requestId ?? null, completed_at: new Date().toISOString(), error_code: null, error_message: null }).eq("id", report.id).eq("status", "generating");
    if (reportError) throw new Error(`ai_report_persist_failed:${reportError.message}`);
    const { error: jobError } = await db.from("jobs").update({ status: "completed", completed_at: new Date().toISOString(), lease_token: null, lease_expires_at: null, last_error_code: null, last_error_message: null }).eq("id", job.job_id).eq("lease_token", lease);
    if (jobError) throw new Error(`ai_job_complete_failed:${jobError.message}`);
    return { status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const terminal = !isRetryableAIError(message) || job.attempt_count >= 3;
    const next = new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.max(0, job.attempt_count - 1))).toISOString();
    await db.from("ai_reports").update({ status: "failed", error_code: message.slice(0, 120), error_message: "AI report generation failed" }).eq("id", report.id).eq("status", "generating");
    await db.from("jobs").update({ status: "failed", available_at: terminal ? new Date("2099-01-01").toISOString() : next, attempts: terminal ? 3 : job.attempt_count, last_error_code: "ai_failed", last_error_message: message, lease_token: null, lease_expires_at: null }).eq("id", job.job_id).eq("lease_token", lease);
    return { status: "failed" };
  }
}
