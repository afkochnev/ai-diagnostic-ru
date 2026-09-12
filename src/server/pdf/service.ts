import "server-only";
import crypto from "node:crypto";
import { createAdminClient } from "@/server/supabase/admin";
import { renderPdf } from "./render";

const templateVersion = "stage7a-2";
type Row = Record<string, unknown>;
const transliterate = (value: string) => value.toLowerCase().replace(/[а-яё]/g, (char) => ({ а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" }[char] ?? char)).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "company";

async function loadAuthorizedReport(reportId: string, userId: string) {
  const db = createAdminClient();
  const { data: report } = await db.from("ai_reports").select("id,diagnostic_id,version,status,structured_content").eq("id", reportId).maybeSingle();
  if (!report || report.status !== "completed") throw new Error("pdf_report_not_ready");
  const { data: diagnostic } = await db.from("diagnostics").select("id,company_id,version_id,status,completed_at,created_by_user_id").eq("id", report.diagnostic_id).eq("created_by_user_id", userId).maybeSingle();
  if (!diagnostic || diagnostic.status !== "completed") throw new Error("pdf_access_denied");
  return { db, report, diagnostic };
}

function fileName(companyName: string, completedAt: string | null) {
  return `management-ai-audit-${transliterate(companyName)}-${new Date(completedAt ?? Date.now()).toISOString().slice(0, 10)}.pdf`;
}

/** Strictly read-only download. It never renders or writes an artifact. */
export async function getPdfForReport(reportId: string, userId: string): Promise<{ bytes: Buffer; fileName: string }> {
  const { db, report, diagnostic } = await loadAuthorizedReport(reportId, userId);
  const [{ data: snapshot }, { data: artifact }] = await Promise.all([
    db.from("diagnostic_company_snapshots").select("profile_data").eq("diagnostic_id", diagnostic.id).maybeSingle(),
    db.from("report_artifacts").select("ai_report_version,status,content_base64").eq("report_id", report.id).eq("ai_report_version", report.version).eq("format", "pdf").eq("template_version", templateVersion).eq("status", "ready").maybeSingle(),
  ]);
  if (!snapshot || !artifact?.content_base64) throw new Error("pdf_artifact_not_ready");
  const profile = (snapshot.profile_data ?? {}) as Row;
  return { bytes: Buffer.from(String(artifact.content_base64), "base64"), fileName: fileName(String(profile.name ?? "Компания"), diagnostic.completed_at) };
}

/** Explicit mutation path. Callers must authenticate and authorize before this service. */
export async function preparePdfForReport(reportId: string, userId: string): Promise<{ status: "ready"; fileName: string }> {
  const { db, report, diagnostic } = await loadAuthorizedReport(reportId, userId);
  const [{ data: snapshot }, { data: result }] = await Promise.all([
    db.from("diagnostic_company_snapshots").select("profile_data").eq("diagnostic_id", diagnostic.id).maybeSingle(),
    db.from("diagnostic_results").select("id,display_manageability_index,maturity_level_id").eq("diagnostic_id", diagnostic.id).maybeSingle(),
  ]);
  if (!snapshot || !result) throw new Error("pdf_result_missing");
  const existing = await db.from("report_artifacts").select("status,content_base64").eq("report_id", report.id).eq("ai_report_version", report.version).eq("format", "pdf").eq("template_version", templateVersion).maybeSingle();
  if (existing.data?.status === "ready" && existing.data.content_base64) {
    const profile = (snapshot.profile_data ?? {}) as Row;
    return { status: "ready", fileName: fileName(String(profile.name ?? "Компания"), diagnostic.completed_at) };
  }
  const [{ data: maturity }, { data: blocks }, { data: blockResults }, { data: blockTexts }] = await Promise.all([
    db.from("maturity_level_translations").select("label").eq("maturity_level_id", result.maturity_level_id).eq("locale", "ru").maybeSingle(),
    db.from("diagnostic_blocks").select("id,key,weight,position").eq("version_id", diagnostic.version_id).eq("is_active", true).order("position"),
    db.from("diagnostic_block_results").select("block_id,display_score").eq("result_id", result.id),
    db.from("diagnostic_block_translations").select("block_id,title").eq("locale", "ru"),
  ]);
  const scoringBlocks = (blocks ?? []).filter((block) => Number(block.weight) > 0);
  const resultMap = new Map((blockResults ?? []).map((row) => [row.block_id, row]));
  const titleMap = new Map((blockTexts ?? []).map((row) => [row.block_id, row.title]));
  const profile = (snapshot.profile_data ?? {}) as Row;
  const reportContent = (report.structured_content ?? {}) as Record<string, string | string[]>;
  const pdfInput = { companyName: String(profile.name ?? "Компания"), completedAt: diagnostic.completed_at, index: String(result.display_manageability_index ?? "—").replace(".", ","), maturity: String(maturity?.label ?? "—"), blocks: scoringBlocks.map((block) => ({ title: String(titleMap.get(block.id) ?? block.key), score: String(resultMap.get(block.id)?.display_score ?? "—").replace(".", ",") })), report: reportContent };
  const bytes = await renderPdf(pdfInput);
  const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
  const path = `reports/${report.id}/${templateVersion}.pdf`;
  const { error: artifactError } = await db.from("report_artifacts").upsert({ report_id: report.id, ai_report_version: report.version, format: "pdf", template_version: templateVersion, status: "ready", storage_path: path, content_base64: bytes.toString("base64"), checksum }, { onConflict: "report_id,format,template_version" });
  if (artifactError) throw new Error("pdf_artifact_failed");
  return { status: "ready", fileName: fileName(pdfInput.companyName, diagnostic.completed_at) };
}

export { templateVersion };
