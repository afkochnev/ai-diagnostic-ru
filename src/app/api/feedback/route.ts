import { NextResponse } from "next/server";
import { getIdentity } from "@/server/auth/session";
import { createFeedback } from "@/server/feedback/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const identity = await getIdentity();
    if (!identity || !identity.user.email_confirmed_at) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const result = await createFeedback(await request.json());
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "feedback_failed";
    const status = code === "invalid_feedback_input" || code === "invalid_rating" ? 400 : code.includes("unauthorized") || code.includes("not_owned") || code.includes("not_verified") ? 403 : 500;
    return NextResponse.json({ error: status === 400 ? "validation_error" : status === 403 ? "access_denied" : "feedback_failed" }, { status });
  }
}
