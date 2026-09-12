import "server-only";
import { createAuthClient } from "@/server/supabase/server";

export async function getDiagnosticResult(id: string, userId: string) {
  const c = await createAuthClient();
  const { data: diagnostic, error } = await c.from("diagnostics").select("id,company_id,status,version_id,submitted_at,completed_at").eq("id", id).eq("created_by_user_id", userId).maybeSingle();
  if (error || !diagnostic) return null;
  const [{ data: company }, { data: result }, { data: blocks }, { data: completedReport }, { data: processReport }] = await Promise.all([
    c.from("company_profiles").select("name").eq("id", diagnostic.company_id).single(),
    c.from("diagnostic_results").select("id,diagnostic_id,version_id,raw_manageability_index,display_manageability_index,maturity_level_id").eq("diagnostic_id", id).maybeSingle(),
    c.from("diagnostic_blocks").select("id,key,position,weight").eq("version_id", diagnostic.version_id).eq("is_active", true).order("position"),
    c.from("ai_reports").select("id,status,structured_content,error_code,version,prompt_version").eq("diagnostic_id", id).eq("status", "completed").order("version", { ascending: false }).limit(1).maybeSingle(),
    c.from("ai_reports").select("id,status,structured_content,error_code,version,prompt_version").eq("diagnostic_id", id).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const aiReport = completedReport ?? processReport;
  if (!result) return { diagnostic, company, result: null, blocks: [], blockResults: [], aiReport };
  const scoring = (blocks ?? []).filter((b) => Number(b.weight) > 0);
  const [{ data: blockResults }, { data: maturity }, { data: texts }] = await Promise.all([
    c.from("diagnostic_block_results").select("id,result_id,block_id,raw_score,display_score,question_count").eq("result_id", result.id),
    result.maturity_level_id ? c.from("maturity_level_translations").select("label").eq("maturity_level_id", result.maturity_level_id).eq("locale", "ru").maybeSingle() : Promise.resolve({ data: null }),
    c.from("diagnostic_block_translations").select("block_id,title").eq("locale", "ru").in("block_id", scoring.map((b) => b.id)),
  ]);
  const names = new Map((texts ?? []).map((t) => [t.block_id, t.title]));
  const resultMap = new Map((blockResults ?? []).map((b) => [b.block_id, b]));
  return { diagnostic, company, result: { ...result, maturity_label: maturity?.label ?? "" }, blocks: scoring.map((b) => ({ ...b, title: names.get(b.id) ?? "Блок", result: resultMap.get(b.id) ?? null })), blockResults: blockResults ?? [], aiReport };
}
