import { NextResponse } from "next/server";
import { getIdentity } from "@/server/auth/session";
import { submitDiagnostic } from "@/server/diagnostic/submission";
export async function POST(request: Request, { params }: { params: Promise<{ diagnosticId: string }> }) {
  const identity = await getIdentity(); if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})); const { diagnosticId } = await params;
  try { return NextResponse.json(await submitDiagnostic(diagnosticId, Number(body.expected_revision))); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "submit_failed" }, { status: 409 }); }
}
