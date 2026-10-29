import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth/admin";
import { preparePdfForAdminReport } from "@/server/pdf/service";
import { adminPdfFailure, adminPdfHeaders, pdfReportIdValid, emptyAdminPdfBody } from "@/server/pdf/admin-http";
import { enforceRateLimit, RateLimitExceeded } from "@/server/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const admin = await requireAdmin();
  const { reportId } = await params;
  if (!pdfReportIdValid(reportId)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: adminPdfHeaders });
  let origin: string;
  try { origin = new URL(process.env.APP_URL ?? "").origin; }
  catch { return NextResponse.json({ error: "pdf_prepare_failed" }, { status: 503, headers: adminPdfHeaders }); }
  if (request.headers.get("origin") !== origin || ![null, "same-origin"].includes(request.headers.get("sec-fetch-site"))) return NextResponse.json({ error: "access_denied" }, { status: 403, headers: adminPdfHeaders });
  // Browser supplies no identity, authority, template or render input. Do not consume arbitrary bodies.
  if (!(await emptyAdminPdfBody(request))) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: adminPdfHeaders });
  try {
    await enforceRateLimit(`admin-pdf-prepare:user:${admin.user.id}`, 5, 3600);
    return NextResponse.json(await preparePdfForAdminReport(reportId), { headers: adminPdfHeaders });
  } catch (error) {
    if (error instanceof RateLimitExceeded) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...adminPdfHeaders, "Retry-After": String(error.retryAfter) } });
    return adminPdfFailure(error);
  }
}
