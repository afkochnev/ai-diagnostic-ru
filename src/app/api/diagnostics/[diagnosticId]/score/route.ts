import { NextResponse } from "next/server";
import { getIdentity } from "@/server/auth/session";
import { AccountAccessError, requireDiagnosticRead } from "@/server/account/authorization";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedStatuses = new Set(["submitted", "scoring_failed"]);

export async function POST(_: Request, { params }: { params: Promise<{ diagnosticId: string }> }) {
  const identity = await getIdentity();
  const { diagnosticId } = await params;
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!uuid.test(diagnosticId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Current membership and the diagnostic's actual company are checked through
  // the authenticated client before any worker-compatible status is exposed.
  let diagnostic;
  try { diagnostic = await requireDiagnosticRead(diagnosticId, identity.user.id); }
  catch (error) {
    if (error instanceof AccountAccessError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw error;
  }

  // This endpoint is a status read/kick-compatible surface only. Production
  // execution is performed by the long-running worker, never by the browser.
  // `await runScoringJob` is intentionally absent from this request path.
  if (diagnostic.status === "completed") return NextResponse.json({ status: "completed" });
  if (diagnostic.status === "scoring") return NextResponse.json({ status: "scoring" }, { status: 202 });
  if (allowedStatuses.has(diagnostic.status)) {
    return NextResponse.json({ status: diagnostic.status === "submitted" ? "queued" : "scoring_failed" }, { status: 202 });
  }
  return NextResponse.json({ error: "not_ready" }, { status: 409 });
}
