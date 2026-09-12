import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth/admin";
import { createAdminClient } from "@/server/supabase/admin";

export async function GET(_: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  await requireAdmin();
  const { artifactId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(artifactId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data } = await createAdminClient().from("report_artifacts").select("content_base64,format,status").eq("id", artifactId).eq("format", "pdf").eq("status", "ready").maybeSingle();
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(Buffer.from(data.content_base64, "base64"), { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=admin-report.pdf", "cache-control": "private, no-store" } });
}
