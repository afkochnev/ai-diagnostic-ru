import "server-only";
import { NextResponse } from "next/server";
import { adminPdfError } from "./service";
export const adminPdfHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
export const pdfReportIdValid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export function adminPdfFailure(error: unknown) {
  const code = adminPdfError(error);
  const denied = code === "pdf_access_denied";
  const pending = ["pdf_report_not_ready", "pdf_artifact_not_ready", "pdf_result_missing"].includes(code);
  const conflict = ["pdf_source_conflict", "pdf_artifact_conflict", "pdf_integrity_failed"].includes(code);
  return NextResponse.json({ error: denied ? "not_found" : pending ? "pdf_not_ready" : code }, { status: denied ? 404 : pending || conflict ? 409 : 500, headers: adminPdfHeaders });
}

/** Empty POST bodies can still arrive as a stream through the Next HTTP adapter. */
export async function emptyAdminPdfBody(request: Request): Promise<boolean> {
  const length = request.headers.get("content-length");
  if (length !== null && length !== "0") return false;
  if (!request.body) return true;
  if (request.body.locked) return false;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([reader.read(), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1000); })]);
    return result !== null && result.done === true;
  } catch { return false; }
  finally { if (timer) clearTimeout(timer); void reader.cancel().catch(() => {}); }
}
