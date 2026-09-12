import "server-only";

import { requireAdmin } from "@/server/auth/admin";
import { createAdminClient } from "@/server/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getAdminDiagnosticDetail(diagnosticId: string) {
  await requireAdmin();
  if (!uuid.test(diagnosticId)) return null;
  const db = createAdminClient();
  const { data: diagnostic, error } = await db.from("diagnostics").select("id,company_id,created_by_user_id,version_id,status,started_at,submitted_at,completed_at").eq("id", diagnosticId).maybeSingle();
  if (error || !diagnostic) return null;
  const [{ data: company }, { data: snapshot }, { data: user }, { data: result }, { data: blocks }, { data: reports }, { data: answers }, { data: questions }, { data: questionTexts }, { data: options }, { data: optionTexts }] = await Promise.all([
    db.from("company_profiles").select("id,name,country,industry_key,employee_count,company_age_years,annual_revenue_key,management_levels,products,customer_segments,sales_channels,main_goals,key_problems").eq("id", diagnostic.company_id).maybeSingle(),
    db.from("diagnostic_company_snapshots").select("profile_data").eq("diagnostic_id", diagnosticId).maybeSingle(),
    db.from("users").select("id,full_name,locale,phone").eq("id", diagnostic.created_by_user_id).maybeSingle(),
    db.from("diagnostic_results").select("id,raw_manageability_index,display_manageability_index,maturity_level_id,calculation_version,created_at").eq("diagnostic_id", diagnosticId).maybeSingle(),
    db.from("diagnostic_blocks").select("id,key,position,weight,is_active").eq("version_id", diagnostic.version_id).order("position"),
    db.from("ai_reports").select("id,version,status,model,prompt_version,schema_version,created_at,completed_at,structured_content").eq("diagnostic_id", diagnosticId).order("version", { ascending: false }),
    db.from("answers").select("id,question_id,numeric_value,text_value,revision,updated_at").eq("diagnostic_id", diagnosticId),
    db.from("questions").select("id,block_id,position,answer_type,is_required").eq("version_id", diagnostic.version_id).eq("is_active", true).order("position"),
    db.from("question_translations").select("question_id,prompt").eq("locale", "ru"),
    db.from("question_options").select("id,question_id,position,score_value").order("position"),
    db.from("question_option_translations").select("option_id,label").eq("locale", "ru"),
  ]);
  const { data: artifacts } = (reports ?? []).length ? await db.from("report_artifacts").select("id,report_id,ai_report_version,format,template_version,status,generated_at,storage_path").in("report_id", (reports ?? []).map((report) => report.id)) : { data: [] };
  const maturity = result?.maturity_level_id ? (await db.from("maturity_level_translations").select("label").eq("maturity_level_id", result.maturity_level_id).eq("locale", "ru").maybeSingle()).data : null;
  const blockTranslations = (await db.from("diagnostic_block_translations").select("block_id,title").eq("locale", "ru").in("block_id", (blocks ?? []).map((block) => block.id))).data ?? [];
  const profileUnavailable = diagnostic.status === "completed" && !snapshot;
  const sourceProfile = (snapshot?.profile_data ?? (profileUnavailable ? {} : company) ?? {}) as Record<string, unknown>;
  const industryKey = typeof sourceProfile.industry_key === "string" ? sourceProfile.industry_key : null;
  const revenueKey = typeof sourceProfile.annual_revenue_key === "string" ? sourceProfile.annual_revenue_key : null;
  const industryLabel = industryKey ? (await db.from("industry_translations").select("name").eq("industry_key", industryKey).eq("locale", "ru").maybeSingle()).data?.name : null;
  const revenueLabel = revenueKey ? (await db.from("revenue_range_translations").select("name").eq("revenue_key", revenueKey).eq("locale", "ru").maybeSingle()).data?.name : null;
  const blockMap = new Map(blockTranslations.map((row) => [row.block_id, row.title]));
  const questionTextMap = new Map((questionTexts ?? []).map((row) => [row.question_id, row.prompt]));
  const answerMap = new Map((answers ?? []).map((answer) => [answer.question_id, answer]));
  const optionTextMap = new Map((optionTexts ?? []).map((row) => [row.option_id, row.label]));
  const optionsMap = new Map<string, { label: string; score: number }[]>();
  for (const option of options ?? []) optionsMap.set(option.question_id, [...(optionsMap.get(option.question_id) ?? []), { label: optionTextMap.get(option.id) ?? String(option.position), score: option.score_value }]);
  const answerGroups = (blocks ?? []).map((block) => ({
    id: block.id, title: blockMap.get(block.id) ?? block.key,
    questions: (questions ?? []).filter((question) => question.block_id === block.id).sort((a, b) => a.position - b.position).map((question) => ({ questionId: question.id, position: question.position, prompt: questionTextMap.get(question.id) ?? "", answerType: question.answer_type, answer: answerMap.get(question.id) ?? null, options: optionsMap.get(question.id) ?? [] })),
  }));
  const resultBlockRows = result ? (await db.from("diagnostic_block_results").select("id,block_id,raw_score,display_score,question_count").eq("result_id", result.id)).data ?? [] : [];
  const profile: Record<string, unknown> = { ...sourceProfile, industry_label: industryLabel ?? undefined, annual_revenue_label: revenueLabel ?? undefined };
  return { diagnostic, company: profile, profileUnavailable, user, result: result ? { ...result, maturity_label: maturity?.label ?? null } : null, blocks: answerGroups, blockResults: resultBlockRows, reports: reports ?? [], artifacts: artifacts ?? [] };
}
