import { NextResponse } from "next/server";
import { z } from "zod";
import { getIdentity } from "@/server/auth/session";
import { DiagnosticError, saveDiagnosticAnswers } from "@/server/diagnostic/service";

const schema = z.object({ expected_revision: z.number().int().positive(), mutation_id: z.uuid(), current_block_id: z.uuid(), answers: z.array(z.object({ question_id: z.uuid(), value: z.union([z.number(), z.string(), z.null()]) })) });

export async function PATCH(request: Request, { params }: { params: Promise<{ diagnosticId: string }> }) {
  const identity = await getIdentity();
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { diagnosticId } = await params;
  try {
    const result = await saveDiagnosticAnswers(diagnosticId, identity.user.id, parsed.data.expected_revision, parsed.data.mutation_id, parsed.data.current_block_id, parsed.data.answers);
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof DiagnosticError ? error.code : "invalid";
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid_request", code }, { status: code === "conflict" ? 409 : code === "not_found" ? 404 : 400 });
  }
}
