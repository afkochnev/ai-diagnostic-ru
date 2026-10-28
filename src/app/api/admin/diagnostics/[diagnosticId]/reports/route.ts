import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth/admin";
import { createAdminClient } from "@/server/supabase/admin";
import { requestNextAIReportVersion } from "@/server/ai/regeneration";
import { enforceRateLimit, RateLimitExceeded } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ diagnosticId: string }> };

export async function GET(_: Request, { params }: Context) {
  await requireAdmin();
  const { diagnosticId } = await params;
  if (!UUID.test(diagnosticId)) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  const db = createAdminClient();
  const { data, error } = await db.from("ai_reports").select("id,version,status").eq("diagnostic_id", diagnosticId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: "report_status_unavailable" }, { status: 503, headers });
  if (!data) return NextResponse.json({ status: "missing" }, { headers });
  return NextResponse.json({ id: data.id, version: data.version, status: data.status, ...(data.status === "failed" ? { error_class: "AI_REPORT_FAILED" } : {}) }, { headers });
}

export async function POST(_: Request, { params }: Context) {
  const admin = await requireAdmin();
  const { diagnosticId } = await params;
  if (!UUID.test(diagnosticId)) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  try {
    await enforceRateLimit(`admin-ai-regeneration:user:${admin.user.id}`, 3, 86400);
    const report = await requestNextAIReportVersion(diagnosticId);
    return NextResponse.json({ id: report.id, version: report.version, status: report.status }, { status: 202, headers });
  } catch (error) {
    if (error instanceof RateLimitExceeded) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(error.retryAfter) } });
    if (error instanceof Error && error.message === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404, headers });
    return NextResponse.json({ error: "report_regeneration_unavailable" }, { status: 503, headers });
  }
}
