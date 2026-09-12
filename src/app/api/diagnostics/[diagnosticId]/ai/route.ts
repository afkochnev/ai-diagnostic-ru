import { NextResponse } from "next/server";
import { getIdentity } from "@/server/auth/session";
import { createAuthClient } from "@/server/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_: Request, { params }: { params: Promise<{ diagnosticId: string }> }) {
  const identity = await getIdentity();
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { diagnosticId } = await params;
  if (!UUID.test(diagnosticId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const db = await createAuthClient();
  const { data: diagnostic } = await db.from("diagnostics").select("id").eq("id", diagnosticId).eq("created_by_user_id", identity.user.id).maybeSingle();
  if (!diagnostic) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: report } = await db.from("ai_reports").select("id,version,status,error_code").eq("diagnostic_id", diagnosticId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (!report) return NextResponse.json({ status: "missing" }, { headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ status: report.status, report_id: report.id, version: report.version, ...(report.status === "failed" ? { error_code: report.error_code } : {}) }, { headers: { "Cache-Control": "private, no-store" } });
}
