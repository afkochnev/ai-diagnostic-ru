import { NextResponse } from "next/server";
import { z } from "zod";
import { getIdentity } from "@/server/auth/session";
import { enforceRateLimit, RateLimitExceeded } from "@/server/rate-limit";
import { getParticipantResult } from "@/server/team/participant-result-service";
import { renderParticipantResultPdf } from "@/server/team/participant-result-pdf-render";
import { teamFoundationEnabled } from "@/server/team/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_: Request, { params }: { params: Promise<{ participantId: string }> }) {
  if (!teamFoundationEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404, headers: privateHeaders });
  const identity = await getIdentity();
  if (!identity?.user.email_confirmed_at || (identity.role === "administrator" && identity.aal !== "aal2")) return NextResponse.json({ error: "access_denied" }, { status: 401, headers: privateHeaders });
  const { participantId } = await params;
  if (!z.uuid().safeParse(participantId).success) return NextResponse.json({ error: "not_found" }, { status: 404, headers: privateHeaders });
  try {
    const result = await getParticipantResult(participantId);
    await enforceRateLimit(`team-participant-pdf:${identity.user.id}`, 6, 60);
    const bytes = await renderParticipantResultPdf(result);
    return new NextResponse(new Uint8Array(bytes), { headers: { ...privateHeaders, "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="team-diagnostic-my-result.pdf"' } });
  } catch (cause) {
    if (cause instanceof RateLimitExceeded) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(cause.retryAfter) } });
    const code = cause instanceof Error ? cause.message : "";
    const status = code === "team_result_incomplete" ? 409 : code === "team_response_unavailable" || code === "team_result_unavailable" ? 404 : 500;
    return NextResponse.json({ error: status === 409 ? "result_incomplete" : status === 404 ? "not_found" : "pdf_failed" }, { status, headers: privateHeaders });
  }
}
