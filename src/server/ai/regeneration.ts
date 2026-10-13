import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { AccountAccessError, requireDiagnosticWrite } from "@/server/account/authorization";
import { enqueueAIReport } from "./worker";

/** Request authorization stays outside the standalone worker import graph. */
export async function requestAIReportRegeneration(userId: string, diagnosticId: string) {
  let diagnostic;
  try { diagnostic = await requireDiagnosticWrite(diagnosticId, userId); }
  catch (error) {
    if (error instanceof AccountAccessError) throw new Error("not_found");
    throw error;
  }
  if (diagnostic.status !== "completed") throw new Error("not_found");
  const db = createAdminClient();
  const { data: result } = await db.from("diagnostic_results").select("id").eq("diagnostic_id", diagnosticId).maybeSingle();
  if (!result) throw new Error("not_found");
  const { data: reports } = await db.from("ai_reports").select("id,version,status").eq("diagnostic_id", diagnosticId).order("version", { ascending: false });
  const current = reports ?? [];
  const active = current.find((report) => report.status === "queued" || report.status === "generating");
  if (active) return active;
  const nextVersion = (current[0]?.version ?? 0) + 1;
  return enqueueAIReport(diagnosticId, nextVersion);
}
