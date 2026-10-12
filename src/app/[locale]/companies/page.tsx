import { CompanyList } from "@/features/company/company-list";
import { requireIdentity } from "@/server/auth/session";

export default async function CompaniesPage() {
  const identity = await requireIdentity();
  return <CompanyList userId={identity.user.id} />;
}
