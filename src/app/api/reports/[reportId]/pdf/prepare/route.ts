import { NextResponse } from "next/server";
import { requireIdentity } from "@/server/auth/session";
import { preparePdfForReport } from "@/server/pdf/service";
import { enforceRateLimit, RateLimitExceeded } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_: Request, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const identity = await requireIdentity();
    const { reportId } = await params;
    if (!uuid.test(reportId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await enforceRateLimit(`pdf-prepare:user:${identity.user.id}`, 5, 3600);
    const prepared = await preparePdfForReport(reportId, identity.user.id);
    return NextResponse.json(prepared, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RateLimitExceeded) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(error.retryAfter) } });
    const code = error instanceof Error ? error.message : "pdf_prepare_failed";
    const status = code === "pdf_access_denied" ? 403 : code === "pdf_report_not_ready" || code === "pdf_result_missing" ? 409 : 500;
    return NextResponse.json({ error: status === 403 ? "access_denied" : status === 409 ? "pdf_not_ready" : "pdf_prepare_failed" }, { status });
  }
}
