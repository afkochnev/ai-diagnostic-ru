import { CompanyList } from "@/features/company/company-list";
import { requireIdentity } from "@/server/auth/session";

export default async function AccountCompaniesPage({ params }: { params: Promise<{ accountId: string }> }) {
  const identity = await requireIdentity();
  const { accountId } = await params;
  return <CompanyList userId={identity.user.id} accountId={accountId} />;
}
