import { createAdminClient } from "@/server-runtime/supabase/admin";
import { calculateBlockScore, calculateOverall, classifyMaturity } from "./engine";
import crypto from "node:crypto";
import { enqueueAIReport } from "@/server/ai/worker";

export type ClaimedScoringJob = { job_id: string; diagnostic_id: string; lease_token: string; attempt_count: number };

export async function runScoringJob(job: ClaimedScoringJob) {
  const db = createAdminClient();
  const { diagnostic_id: diagnosticId, job_id: jobId, lease_token: lease } = job;
  console.info("[job-claim]", { diagnostic_id: diagnosticId, job_id: jobId, kind: "score_diagnostic", attempt: job.attempt_count, status: "running" });
  try {
    await db.from("diagnostics").update({ status: "scoring" }).eq("id", diagnosticId).eq("status", "submitted");
    const { data: d, error: diagnosticError } = await db.from("diagnostics").select("id,version_id").eq("id", diagnosticId).single();
    if (diagnosticError || !d) throw new Error("scoring_diagnostic_missing");
    const [{ data: blocks, error: blocksError }, { data: questions, error: questionsError }, { data: answers, error: answersError }, { data: maturity, error: maturityError }] = await Promise.all([
      db.from("diagnostic_blocks").select("id,weight,is_active").eq("version_id", d.version_id).eq("is_active", true).order("position"),
      db.from("questions").select("id,block_id,weight,reverse_score,is_required,is_active,answer_type").eq("version_id", d.version_id).eq("is_active", true),
      db.from("answers").select("question_id,numeric_value,text_value").eq("diagnostic_id", diagnosticId),
      db.from("maturity_levels").select("id,key").eq("version_id", d.version_id)
    ]);
    if (blocksError || questionsError || answersError || maturityError || !blocks || !questions || !answers) throw new Error("scoring_input_missing");
    const scored = blocks.filter((b) => Number(b.weight) > 0).map((b) => ({ ...calculateBlockScore({ block_id:b.id, block_weight:b.weight, questions:questions.filter((q)=>q.block_id===b.id) as never, answers:answers as never }), block_weight:b.weight, question_count:questions.filter((q)=>q.block_id===b.id && q.answer_type==='scale_0_4').length }));
    const overall = calculateOverall(scored);
    const level = classifyMaturity(overall.raw); const maturityKey = ["critical","weak","developing","mature","strong"][level - 1];
    const maturityRow = (maturity ?? []).find((m) => m.key === maturityKey);
    const inputHash = crypto.createHash("sha256").update(JSON.stringify({ questions, answers })).digest("hex");
    const { data: existingResult } = await db.from("diagnostic_results").select("id").eq("diagnostic_id", diagnosticId).maybeSingle();
    const { data: result, error: resultError } = existingResult ? { data: existingResult, error: null } : await db.from("diagnostic_results").insert({ diagnostic_id: diagnosticId, version_id:d.version_id, raw_manageability_index:overall.raw.toString(), display_manageability_index:overall.display.toString(), maturity_level_id:maturityRow?.id ?? null, calculation_version:"ru-1.0-stage5", input_hash:inputHash }).select("id").single();
    if (resultError || !result) throw resultError ?? new Error("result_write_failed");
    await db.from("diagnostic_block_results").upsert(scored.map((b)=>({ result_id:result.id, block_id:b.block_id, version_id:d.version_id, raw_score:b.raw.toString(), display_score:b.display.toString(), question_count:b.question_count })), { onConflict:"result_id,block_id", ignoreDuplicates:true });
    await db.from("diagnostics").update({ status:"completed", completed_at:new Date().toISOString() }).eq("id",diagnosticId).eq("status","scoring");
    await db.from("jobs").update({ status:"completed", completed_at:new Date().toISOString(), lease_token:null, lease_expires_at:null }).eq("id",jobId).eq("lease_token",lease);
    await enqueueAIReport(diagnosticId);
    console.info("[score-complete]", { diagnostic_id:diagnosticId, job_id:jobId, kind: "score_diagnostic", status:"completed" }); return { status:"completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const terminal = /(?:input_missing|diagnostic_missing|result_write_failed|block_result_missing)/.test(message) || job.attempt_count >= 3;
    const next = new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.max(0, job.attempt_count - 1))).toISOString();
    await db.from("jobs").update({ status:"failed", available_at: terminal ? new Date("2099-01-01").toISOString() : next, attempts: terminal ? 3 : job.attempt_count, last_error_code:"scoring_failed", last_error_message:message, lease_token:null, lease_expires_at:null }).eq("id",jobId).eq("lease_token",lease);
    await db.from("diagnostics").update({ status:"scoring_failed" }).eq("id",diagnosticId).eq("status","scoring");
    console.error("[score-error]", { diagnostic_id:diagnosticId, job_id:jobId, error:message }); return { status:"failed" };
  }
}
