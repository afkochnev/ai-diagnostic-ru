import { CompanyDashboard } from "@/features/company/company-dashboard";
import { requireCompanyRoute } from "@/features/company/company-route";
import { requireIdentity } from "@/server/auth/session";

export default async function CompanyByIdPage({ params }: { params: Promise<{ companyId: string }> }) {
  const identity = await requireIdentity();
  const { companyId } = await params;
  const company = await requireCompanyRoute(companyId, identity.user.id);
  return <CompanyDashboard company={company} userId={identity.user.id} />;
}
