import "server-only";
import { createAuthClient } from "@/server/supabase/server";

export type DiagnosticAnswerInput = { question_id: string; value: number | string | null };
export type SaveDiagnosticResult = { revision: number; current_block_id: string };
export type DiagnosticPageData = Awaited<ReturnType<typeof getDiagnostic>>;
export class DiagnosticError extends Error { constructor(public readonly code: "not_found" | "conflict" | "invalid", message: string) { super(message); } }

export async function createDiagnostic(userId: string) {
  const client = await createAuthClient();
  const { data: company } = await client.from("company_profiles").select("id").eq("owner_user_id", userId).maybeSingle();
  if (!company) throw new DiagnosticError("not_found", "Company profile is required");
  const { data: version, error: versionError } = await client.from("diagnostic_versions").select("id").eq("status", "published").order("version_number", { ascending: false }).limit(1).maybeSingle();
  if (versionError || !version) throw new DiagnosticError("not_found", "No published methodology");
  const { data: firstBlock } = await client.from("diagnostic_blocks").select("id").eq("version_id", version.id).eq("is_active", true).order("position").limit(1).maybeSingle();
  if (!firstBlock) throw new DiagnosticError("not_found", "Methodology has no blocks");
  const { data: existing } = await client.from("diagnostics").select("id").eq("company_id", company.id).eq("created_by_user_id", userId).eq("status", "in_progress").maybeSingle();
  if (existing) return { id: existing.id, existing: true };
  const { data, error } = await client.from("diagnostics").insert({ company_id: company.id, created_by_user_id: userId, version_id: version.id, locale: "ru", current_block_id: firstBlock.id }).select("id").single();
  if (error?.code === "23505") {
    const { data: retry } = await client.from("diagnostics").select("id").eq("company_id", company.id).eq("created_by_user_id", userId).eq("status", "in_progress").single();
    if (retry) return { id: retry.id, existing: true };
  }
  if (error || !data) throw new DiagnosticError("invalid", "Diagnostic could not be created");
  return { id: data.id, existing: false };
}

export async function getActiveDiagnostic(userId: string, companyId: string) {
  const client = await createAuthClient();
  const { data } = await client.from("diagnostics").select("id,current_block_id,revision,last_saved_at,status").eq("company_id", companyId).eq("created_by_user_id", userId).eq("status", "in_progress").maybeSingle();
  return data;
}

export async function getLatestDiagnostics(userId: string, companyId: string) {
  const client = await createAuthClient();
  const { data } = await client.from("diagnostics").select("id,status,revision,last_saved_at,submitted_at,completed_at").eq("company_id", companyId).eq("created_by_user_id", userId).order("started_at", { ascending: false }).limit(10);
  const rows = data ?? [];
  const completedIds = rows.filter((row) => row.status === "completed").map((row) => row.id);
  if (!completedIds.length) return rows.map((diagnostic) => ({ diagnostic, result: null }));
  const { data: results } = await client.from("diagnostic_results").select("diagnostic_id,display_manageability_index,maturity_level_id").in("diagnostic_id", completedIds);
  const maturityIds = (results ?? []).map((result) => result.maturity_level_id).filter((id): id is string => Boolean(id));
  const { data: levels } = maturityIds.length ? await client.from("maturity_level_translations").select("maturity_level_id,label").eq("locale", "ru").in("maturity_level_id", maturityIds) : { data: [] };
  const resultMap = new Map((results ?? []).map((result) => [result.diagnostic_id, { ...result, maturity_label: (levels ?? []).find((level) => level.maturity_level_id === result.maturity_level_id)?.label ?? "" }]));
  return rows.map((diagnostic) => ({ diagnostic, result: resultMap.get(diagnostic.id) ?? null }));
}

export async function getDiagnostic(diagnosticId: string, userId: string) {
  const client = await createAuthClient();
  const { data: diagnostic, error } = await client.from("diagnostics").select("*").eq("id", diagnosticId).eq("created_by_user_id", userId).maybeSingle();
  if (error || !diagnostic) throw new DiagnosticError("not_found", "Diagnostic not found");
  const [{ data: company }, { data: blocks }, { data: blockTranslations }, { data: questions }, { data: questionTranslations }, { data: options }, { data: optionTranslations }, { data: answers }] = await Promise.all([
    client.from("company_profiles").select("id,name").eq("id", diagnostic.company_id).maybeSingle(),
    client.from("diagnostic_blocks").select("id,key,position,weight,is_active").eq("version_id", diagnostic.version_id).eq("is_active", true).order("position"),
    client.from("diagnostic_block_translations").select("block_id,title,description").eq("locale", "ru"),
    client.from("questions").select("id,block_id,key,position,answer_type,weight,is_required,is_active,reverse_score").eq("version_id", diagnostic.version_id).eq("is_active", true).order("position"),
    client.from("question_translations").select("question_id,prompt,help_text").eq("locale", "ru"),
    client.from("question_options").select("id,question_id,key,position,score_value").order("position"),
    client.from("question_option_translations").select("option_id,label").eq("locale", "ru"),
    client.from("answers").select("question_id,text_value,numeric_value,revision").eq("diagnostic_id", diagnostic.id),
  ]);
  if (!company || !blocks || !questions) throw new DiagnosticError("not_found", "Diagnostic data not found");
  const blockText = new Map((blockTranslations ?? []).map((row) => [row.block_id, row]));
  const questionText = new Map((questionTranslations ?? []).map((row) => [row.question_id, row]));
  const optionText = new Map((optionTranslations ?? []).map((row) => [row.option_id, row.label]));
  const questionOptions = new Map<string, { id: string; position: number; score_value: number; label: string }[]>();
  for (const option of options ?? []) {
    const list = questionOptions.get(option.question_id) ?? [];
    list.push({ id: option.id, position: option.position, score_value: option.score_value, label: optionText.get(option.id) ?? String(option.position) });
    questionOptions.set(option.question_id, list);
  }
  const answerMap = new Map((answers ?? []).map((answer) => [answer.question_id, answer]));
  return {
    diagnostic, company, blocks: (blocks ?? []).map((block) => ({
      ...block, title: blockText.get(block.id)?.title ?? block.key,
      questions: (questions ?? []).filter((question) => question.block_id === block.id).sort((a, b) => a.position - b.position).map((question) => ({ ...question, prompt: questionText.get(question.id)?.prompt ?? "", help_text: questionText.get(question.id)?.help_text ?? null, options: questionOptions.get(question.id) ?? [], answer: answerMap.get(question.id) ?? null })),
    })),
  };
}

export async function saveDiagnosticAnswers(diagnosticId: string, userId: string, expectedRevision: number, mutationId: string, currentBlockId: string, inputs: DiagnosticAnswerInput[], answersDirty = true): Promise<SaveDiagnosticResult> {
  const client = await createAuthClient();
  const { data: diagnostic } = await client.from("diagnostics").select("version_id,revision,current_block_id,status").eq("id", diagnosticId).eq("created_by_user_id", userId).maybeSingle();
  if (!diagnostic || diagnostic.status !== "in_progress") throw new DiagnosticError("not_found", "Diagnostic is not editable");
  const { data: previous } = await client.from("diagnostic_mutations").select("resulting_revision").eq("diagnostic_id", diagnosticId).eq("mutation_id", mutationId).maybeSingle();
  if (previous) return { revision: previous.resulting_revision, current_block_id: currentBlockId };
  if (diagnostic.revision !== expectedRevision) throw new DiagnosticError("conflict", "Diagnostic revision is stale");
  const { data: block } = await client.from("diagnostic_blocks").select("id").eq("id", currentBlockId).eq("version_id", diagnostic.version_id).eq("is_active", true).maybeSingle();
  if (!block) throw new DiagnosticError("invalid", "Block does not belong to methodology");
  const questionMap = new Map<string, { id: string; answer_type: string }>();
  if (answersDirty) {
    const questionIds = inputs.map((input) => input.question_id);
    const { data: questions } = await client.from("questions").select("id,answer_type,version_id").eq("version_id", diagnostic.version_id).in("id", questionIds);
    for (const question of questions ?? []) questionMap.set(question.id, question);
    for (const input of inputs) {
      const question = questionMap.get(input.question_id);
      if (!question) throw new DiagnosticError("invalid", "Question does not belong to pinned methodology");
      if (input.value === null || input.value === "") continue;
      if (question.answer_type === "scale_0_4" && (!Number.isInteger(input.value) || Number(input.value) < 0 || Number(input.value) > 4)) throw new DiagnosticError("invalid", "Scale answer is invalid");
      if (question.answer_type === "text" && typeof input.value !== "string") throw new DiagnosticError("invalid", "Text answer is invalid");
    }
  }
  const { data: updated, error: updateError } = await client.from("diagnostics").update({ current_block_id: currentBlockId, revision: expectedRevision + 1 }).eq("id", diagnosticId).eq("created_by_user_id", userId).eq("revision", expectedRevision).eq("status", "in_progress").select("revision,current_block_id").maybeSingle();
  if (updateError || !updated) throw new DiagnosticError("conflict", "Diagnostic revision is stale");
  if (answersDirty) {
    for (const input of inputs) {
      if (input.value === null || input.value === "") {
        await client.from("answers").delete().eq("diagnostic_id", diagnosticId).eq("question_id", input.question_id);
      } else {
        const question = questionMap.get(input.question_id)!;
        await client.from("answers").upsert({ diagnostic_id: diagnosticId, version_id: diagnostic.version_id, question_id: input.question_id, text_value: question.answer_type === "text" ? String(input.value).trim() : null, numeric_value: question.answer_type === "scale_0_4" ? Number(input.value) : null, revision: expectedRevision + 1 }, { onConflict: "diagnostic_id,question_id" });
      }
    }
  }
  await client.from("diagnostic_mutations").insert({ diagnostic_id: diagnosticId, mutation_id: mutationId, resulting_revision: updated.revision });
  return { revision: updated.revision, current_block_id: updated.current_block_id! };
}
