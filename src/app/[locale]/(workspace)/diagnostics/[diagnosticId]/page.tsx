import { notFound } from "next/navigation";
import { DiagnosticRunner } from "@/features/diagnostic/diagnostic-runner";
import { requireIdentity } from "@/server/auth/session";
import { getDiagnostic, DiagnosticError } from "@/server/diagnostic/service";

export default async function DiagnosticPage({ params }: { params: Promise<{ diagnosticId: string }> }) {
  const identity = await requireIdentity();
  const { diagnosticId } = await params;
  let data: Awaited<ReturnType<typeof getDiagnostic>>;
  try { data = await getDiagnostic(diagnosticId, identity.user.id); }
  catch (error) { if (error instanceof DiagnosticError && error.code === "not_found") notFound(); throw error; }
  return <DiagnosticRunner data={data} />;
}
