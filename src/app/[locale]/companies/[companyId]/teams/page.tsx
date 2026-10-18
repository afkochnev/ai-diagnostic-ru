import { redirect } from "next/navigation";
import { requireIdentity } from "@/server/auth/session";
import { requireCompanyRoute } from "@/features/company/company-route";
export default async function TeamsPage({ params }: { params: Promise<{companyId:string}> }) {
  const identity = await requireIdentity();
  const {companyId} = await params;
  await requireCompanyRoute(companyId, identity.user.id);
  redirect(`/ru/companies/${companyId}/diagnostics?type=team#teams`);
}
