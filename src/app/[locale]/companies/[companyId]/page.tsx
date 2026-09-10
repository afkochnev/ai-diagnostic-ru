import { redirect } from "next/navigation";
import { requireIdentity } from "@/server/auth/session";
import { getCompanyForOwner } from "@/server/company/queries";

export default async function CompanyByIdPage({ params }: { params: Promise<{ companyId: string }> }) {
  const identity = await requireIdentity();
  const { companyId } = await params;
  const company = await getCompanyForOwner(companyId, identity.user.id);
  if (!company) redirect("/ru/access-denied");
  redirect("/ru/company-profile");
}
