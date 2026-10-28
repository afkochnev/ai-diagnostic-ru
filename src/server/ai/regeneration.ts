import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { AccountAccessError, requireDiagnosticWrite } from "@/server/account/authorization";
import { enqueueAIReport } from "./worker";

/** Owner authority is checked independently of the service-role regeneration core. */
export async function requestAIReportRegeneration(userId: string, diagnosticId: string) {
  let diagnostic;
  try { diagnostic = await requireDiagnosticWrite(diagnosticId, userId); }
  catch (error) {
    if (error instanceof AccountAccessError) throw new Error("not_found");
    throw error;
  }
  if (diagnostic.status !== "completed") throw new Error("not_found");
  return requestNextAIReportVersion(diagnosticId);
}

/** Server-only: callers MUST authorize the owner or verified live administrator first.
 * Database uniqueness on (diagnostic_id, version) and the ai_report_vN job key
 * arbitrates concurrent enqueue attempts, without touching earlier versions. */
export async function requestNextAIReportVersion(diagnosticId: string) {
  const db = createAdminClient();
  const { data: diagnostic, error: diagnosticError } = await db.from("diagnostics").select("id,status").eq("id", diagnosticId).maybeSingle();
  if (diagnosticError) throw new Error("report_regeneration_unavailable");
  if (!diagnostic || diagnostic.status !== "completed") throw new Error("not_found");
  const { data: result, error: resultError } = await db.from("diagnostic_results").select("id").eq("diagnostic_id", diagnosticId).maybeSingle();
  if (resultError) throw new Error("report_regeneration_unavailable");
  if (!result) throw new Error("not_found");
  const { data: reports, error: reportsError } = await db.from("ai_reports").select("id,version,status").eq("diagnostic_id", diagnosticId).order("version", { ascending: false });
  if (reportsError) throw new Error("report_regeneration_unavailable");
  const current = reports ?? [];
  const active = current.find((report) => report.status === "queued" || report.status === "generating");
  if (active) return active;
  const nextVersion = (current[0]?.version ?? 0) + 1;
  return enqueueAIReport(diagnosticId, nextVersion);
}
