import { redirect } from "next/navigation";
import { CompanyDashboard } from "@/features/company/company-dashboard";
import { resolveCompanySelection } from "@/features/company/workspace-routing";
import { requireIdentity } from "@/server/auth/session";
import { listAccessibleCompanies } from "@/server/company/queries";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const identity = await requireIdentity();
  const [{ company: requestedId }, companies] = await Promise.all([searchParams, listAccessibleCompanies(identity.user.id)]);
  const selection = resolveCompanySelection(companies, requestedId);
  if (selection.kind === "inaccessible") redirect("/ru/access-denied");
  if (selection.kind === "ambiguous") redirect("/ru/companies");
  if (selection.kind === "missing") redirect("/ru/company-profile");
  return <CompanyDashboard company={selection.company} userId={identity.user.id} />;
}
