import { DiagnosticsHub } from "@/features/company/diagnostics-hub";
import { requireCompanyRoute } from "@/features/company/company-route";
import { requireIdentity } from "@/server/auth/session";

export default async function CompanyDiagnosticsPage({ params, searchParams }: { searchParams: Promise<{type?: string;existingLanguage?: string;existingDiagnostic?: string}>; params: Promise<{ companyId: string }> }) {
  const identity = await requireIdentity();
  const { companyId } = await params;
  const company = await requireCompanyRoute(companyId, identity.user.id);
  const selection = await searchParams;
  return <DiagnosticsHub company={company} userId={identity.user.id} type={selection.type} existingLanguage={selection.existingLanguage} existingDiagnostic={selection.existingDiagnostic} />;
}
