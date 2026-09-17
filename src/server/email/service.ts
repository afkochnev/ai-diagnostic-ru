import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { preparePdfForReport, templateVersion } from "@/server/pdf/service";
import { getEmailProvider } from "./provider";
import { buildReportEmail } from "./content";

type Row = Record<string, unknown>;
const safeCompanyName = (value: unknown) => String(value ?? "компании");
const formatIndex = (value: unknown) => String(value ?? "—").replace(".", ",");

export async function sendReportEmail(reportId: string, userId: string) {
  const db = createAdminClient();
  const { data: report } = await db.from("ai_reports").select("id,diagnostic_id,version,status").eq("id", reportId).maybeSingle();
  if (!report || report.status !== "completed") throw new Error("email_report_not_ready");
  const { data: diagnostic } = await db.from("diagnostics").select("id,company_id,status,completed_at,created_by_user_id").eq("id", report.diagnostic_id).eq("created_by_user_id", userId).maybeSingle();
  if (!diagnostic || diagnostic.status !== "completed") throw new Error("email_access_denied");
  const authUser = await db.auth.admin.getUserById(userId);
  const recipient = authUser.data.user?.email;
  if (!recipient) throw new Error("email_recipient_missing");
  const { data: snapshot } = await db.from("diagnostic_company_snapshots").select("profile_data").eq("diagnostic_id", diagnostic.id).single();
  const { data: result } = await db.from("diagnostic_results").select("display_manageability_index,maturity_level_id").eq("diagnostic_id", diagnostic.id).single();
  if (!snapshot || !result) throw new Error("email_result_missing");
  let artifact = await db.from("report_artifacts").select("id,ai_report_version,template_version,status,content_base64").eq("report_id", report.id).eq("ai_report_version", report.version).eq("format", "pdf").eq("template_version", templateVersion).eq("status", "ready").maybeSingle();
  let filename = `management-ai-audit-${new Date(diagnostic.completed_at ?? Date.now()).toISOString().slice(0, 10)}.pdf`;
  if (!artifact.data?.content_base64) {
    const generated = await preparePdfForReport(report.id, userId);
    filename = generated.fileName;
    artifact = await db.from("report_artifacts").select("id,ai_report_version,template_version,status,content_base64").eq("report_id", report.id).eq("ai_report_version", report.version).eq("format", "pdf").eq("template_version", templateVersion).eq("status", "ready").maybeSingle();
  }
  if (!artifact.data?.id || !artifact.data.content_base64) throw new Error("email_pdf_artifact_missing");
  const profile = (snapshot.profile_data ?? {}) as Row;
  const companyName = safeCompanyName(profile.name);
  const maturity = result.maturity_level_id ? await db.from("maturity_level_translations").select("label").eq("maturity_level_id", result.maturity_level_id).eq("locale", "ru").maybeSingle() : { data: null };
  const provider = getEmailProvider();
  const active = await db.from("email_deliveries").select("id,status").eq("user_id", userId).eq("ai_report_id", report.id).in("status", ["queued", "sending"]).maybeSingle();
  if (active.data) return active.data;
  const { data: delivery, error: insertError } = await db.from("email_deliveries").insert({ user_id: userId, diagnostic_id: diagnostic.id, ai_report_id: report.id, ai_report_version: report.version, pdf_artifact_id: artifact.data.id, recipient_email: recipient, status: "sending", provider: provider.name, attempt_count: 1 }).select("id,status").single();
  if (insertError || !delivery) {
    const duplicate = await db.from("email_deliveries").select("id,status").eq("user_id", userId).eq("ai_report_id", report.id).in("status", ["queued", "sending"]).maybeSingle();
    if (duplicate.data) return duplicate.data;
    throw new Error("email_delivery_create_failed");
  }
  const email = buildReportEmail({ companyName, index: formatIndex(result.display_manageability_index), maturity: maturity.data?.label ?? "—", filename, contentBase64: String(artifact.data.content_base64) });
  email.to = recipient;
  try {
    const sent = await provider.send(email);
    await db.from("email_deliveries").update({ status: "sent", provider_message_id: sent.providerMessageId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", delivery.id);
    return { id: delivery.id, status: "sent" };
  } catch (error) {
    const code = error instanceof Error ? error.message : "email_send_failed";
    await db.from("email_deliveries").update({ status: "failed", last_error_code: code.slice(0, 120), last_error_message: "Email provider request failed", updated_at: new Date().toISOString() }).eq("id", delivery.id);
    throw new Error("email_send_failed");
  }
}
