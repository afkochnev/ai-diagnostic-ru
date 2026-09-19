import { NextResponse } from "next/server";
import { getIdentity } from "@/server/auth/session";
import { requestAIReportRegeneration } from "@/server/ai/worker";
import { enforceRateLimit, RateLimitExceeded } from "@/server/rate-limit";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_: Request, { params }: { params: Promise<{ diagnosticId: string }> }) {
  const identity = await getIdentity();
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { diagnosticId } = await params;
  if (!UUID.test(diagnosticId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    await enforceRateLimit(`ai-regeneration:user:${identity.user.id}`, 3, 86400);
    const report = await requestAIReportRegeneration(identity.user.id, diagnosticId);
    return NextResponse.json({ report_id: report.id, version: report.version, status: report.status }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RateLimitExceeded) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(error.retryAfter) } });
    if (error instanceof Error && error.message === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
    console.error("[report-regeneration]", { diagnostic_id: diagnosticId, user_id: identity.user.id, error_code: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
    return NextResponse.json({ error: "report_regeneration_unavailable" }, { status: 503 });
  }
}
