import { NextResponse } from "next/server";
import { requireIdentity } from "@/server/auth/session";
import { sendReportEmail } from "@/server/email/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const identity = await requireIdentity();
    const { reportId } = await params;
    const delivery = await sendReportEmail(reportId, identity.user.id);
    return NextResponse.json(delivery, { status: delivery.status === "sent" ? 200 : 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "email_failed";
    const status = code.includes("access_denied") ? 403 : code.includes("not_ready") ? 409 : 500;
    return NextResponse.json({ error: status === 403 ? "access_denied" : "email_failed" }, { status });
  }
}
