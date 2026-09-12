import { NextResponse } from "next/server";
import { requireIdentity } from "@/server/auth/session";
import { getPdfForReport } from "@/server/pdf/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(_: Request, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const identity = await requireIdentity();
    const { reportId } = await params;
    if (!uuid.test(reportId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const pdf = await getPdfForReport(reportId, identity.user.id);
    return new NextResponse(new Uint8Array(pdf.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdf.fileName}"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error && ["pdf_report_not_ready", "pdf_artifact_not_ready"].includes(error.message) ? "pdf_not_ready" : error instanceof Error && error.message === "pdf_access_denied" ? "access_denied" : "pdf_failed";
    return NextResponse.json({ error: message }, { status: message === "pdf_not_ready" ? 409 : message === "access_denied" ? 403 : 500 });
  }
}
