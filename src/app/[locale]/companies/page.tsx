import { CompanyList } from "@/features/company/company-list";
import { requireIdentity } from "@/server/auth/session";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const identity = await requireIdentity();
  const { account } = await searchParams;
  return <CompanyList userId={identity.user.id} accountId={account} />;
}
