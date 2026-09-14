import { NextResponse } from "next/server";
import { getIdentity } from "@/server/auth/session";
import { createDiagnostic, DiagnosticError } from "@/server/diagnostic/service";

export async function POST() {
  const identity = await getIdentity();
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await createDiagnostic(identity.user.id);
    return NextResponse.json(result, { status: result.existing ? 200 : 201 });
  } catch (error) {
    const status = error instanceof DiagnosticError && error.code === "not_found" ? 404 : 400;
    return NextResponse.json({ error: error instanceof DiagnosticError && error.code === "not_found" ? "not_found" : "invalid_request" }, { status });
  }
}
