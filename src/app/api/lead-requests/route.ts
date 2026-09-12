import { NextResponse } from "next/server";
import { getIdentity } from "@/server/auth/session";
import { createConsultationLead } from "@/server/consultation/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const identity = await getIdentity();
    if (!identity || !identity.user.email_confirmed_at) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const result = await createConsultationLead(await request.json());
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "consultation_failed";
    const status = code === "invalid_consultation_input" ? 400 : code.includes("unauthorized") || code.includes("not_owned") || code.includes("not_verified") ? 403 : 500;
    return NextResponse.json({ error: status === 400 ? "validation_error" : status === 403 ? "access_denied" : "consultation_failed" }, { status });
  }
}
