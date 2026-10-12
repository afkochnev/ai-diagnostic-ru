import { NextResponse } from "next/server";
import { getIdentity } from "@/server/auth/session";
import { createDiagnostic, DiagnosticError } from "@/server/diagnostic/service";
import { z } from "zod";

const schema = z.object({ company_id: z.uuid().optional() });

export async function POST(request: Request) {
  const identity = await getIdentity();
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const result = await createDiagnostic(identity.user.id, parsed.data.company_id);
    return NextResponse.json(result, { status: result.existing ? 200 : 201 });
  } catch (error) {
    if (error instanceof DiagnosticError && error.code === "selection_required") return NextResponse.json({ error: "selection_required" }, { status: 409 });
    const status = error instanceof DiagnosticError && error.code === "not_found" ? 404 : 400;
    return NextResponse.json({ error: error instanceof DiagnosticError && error.code === "not_found" ? "not_found" : "invalid_request" }, { status });
  }
}
