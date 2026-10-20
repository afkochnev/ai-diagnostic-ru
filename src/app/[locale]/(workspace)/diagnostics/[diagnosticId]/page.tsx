import { notFound, redirect } from "next/navigation";
import { CompanyNavigation } from "@/features/company/company-navigation";
import { DiagnosticRunner } from "@/features/diagnostic/diagnostic-runner";
import { requireIdentity } from "@/server/auth/session";
import { getDiagnostic, DiagnosticError } from "@/server/diagnostic/service";

export default async function DiagnosticPage({ params }: { params: Promise<{ diagnosticId: string }> }) {
  const identity = await requireIdentity();
  const { diagnosticId } = await params;
  let data: Awaited<ReturnType<typeof getDiagnostic>>;
  try { data = await getDiagnostic(diagnosticId, identity.user.id); }
  catch (error) { if (error instanceof DiagnosticError && error.code === "not_found") notFound(); throw error; }
  if (["submitted", "scoring", "scoring_failed", "completed"].includes(data.diagnostic.status)) redirect(`/ru/diagnostics/${diagnosticId}/result`);
  return <DiagnosticRunner key={diagnosticId} data={data} navigation={<CompanyNavigation companyId={data.diagnostic.company_id} userId={identity.user.id} />} />;
}
