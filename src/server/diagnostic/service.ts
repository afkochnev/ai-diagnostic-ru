import "server-only";
import { createAuthClient } from "@/server/supabase/server";

export type DiagnosticAnswerInput = { question_id: string; value: number | string | null };
export type SaveDiagnosticResult = { revision: number; current_block_id: string };
export type DiagnosticPageData = Awaited<ReturnType<typeof getDiagnostic>>;
export class DiagnosticError extends Error { constructor(public readonly code: "not_found" | "conflict" | "invalid", message: string) { super(message); } }

const MANAGEABILITY_DEFINITION_KEY = "manageability";

export type PublishedMethodologyVersion = {
  id: string;
  definition_id: string;
  version_number: number;
  status: string;
};

/** Select the current methodology only within the requested diagnostic definition. */
export function selectCurrentPublishedVersion(
  versions: readonly PublishedMethodologyVersion[],
  definitionId: string,
) {
  return versions
    .filter((version) => version.definition_id === definitionId && version.status === "published")
    .sort((left, right) => right.version_number - left.version_number)[0] ?? null;
}

export async function createDiagnostic(userId: string) {
  const client = await createAuthClient();
  const { data: company } = await client.from("company_profiles").select("id").eq("owner_user_id", userId).maybeSingle();
  if (!company) throw new DiagnosticError("not_found", "Company profile is required");
  const { data: definition, error: definitionError } = await client.from("diagnostic_definitions").select("id").eq("key", MANAGEABILITY_DEFINITION_KEY).maybeSingle();
  if (definitionError || !definition) throw new DiagnosticError("not_found", "No published methodology");
  const { data: versions, error: versionError } = await client.from("diagnostic_versions").select("id,definition_id,version_number,status").eq("definition_id", definition.id).eq("status", "published");
  const version = selectCurrentPublishedVersion((versions ?? []) as PublishedMethodologyVersion[], definition.id);
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
  const { data, error } = await client.rpc("save_diagnostic_block", {
    p_diagnostic_id: diagnosticId,
    p_expected_revision: expectedRevision,
    p_mutation_id: mutationId,
    p_current_block_id: currentBlockId,
    p_answers: inputs,
    p_answers_dirty: answersDirty,
  });
  if (error || !data) {
    const message = error?.message ?? "invalid";
    if (message.includes("conflict")) throw new DiagnosticError("conflict", "Diagnostic revision is stale");
    if (message.includes("not_found")) throw new DiagnosticError("not_found", "Diagnostic is not editable");
    throw new DiagnosticError("invalid", "Diagnostic answers are invalid");
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.revision !== "number" || typeof row.current_block_id !== "string") throw new DiagnosticError("invalid", "Diagnostic save response is invalid");
  return { revision: row.revision, current_block_id: row.current_block_id };
}
