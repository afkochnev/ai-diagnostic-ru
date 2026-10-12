import { CompanyProfileEditor } from "@/features/company/company-profile-editor";
import { requireCompanyRoute } from "@/features/company/company-route";
import { requireIdentity } from "@/server/auth/session";

export default async function CompanyProfileByIdPage({ params }: { params: Promise<{ companyId: string }> }) {
  const identity = await requireIdentity();
  const { companyId } = await params;
  const company = await requireCompanyRoute(companyId, identity.user.id);
  return <CompanyProfileEditor company={company} accountId={company.account_id} />;
}
