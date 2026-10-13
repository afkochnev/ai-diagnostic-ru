import { redirect } from "next/navigation";
import { CompanyProfileEditor } from "@/features/company/company-profile-editor";
import { resolveCompanySelection } from "@/features/company/workspace-routing";
import { requireIdentity } from "@/server/auth/session";
import { listAccessibleAccounts } from "@/server/account/queries";
import { listAccessibleCompanies } from "@/server/company/queries";

export default async function CompanyProfilePage({ searchParams }: { searchParams: Promise<{ company?: string; account?: string }> }) {
  const identity = await requireIdentity();
  const [{ company: companyId, account: accountId }, accounts, companies] = await Promise.all([
    searchParams, listAccessibleAccounts(identity.user.id), listAccessibleCompanies(identity.user.id),
  ]);
  const account = accountId === undefined ? null : accounts.find(({ id }) => id === accountId);
  if (accountId !== undefined && !account) redirect("/ru/access-denied");
  const selection = resolveCompanySelection(account ? companies.filter((company) => company.account_id === account.id) : companies, companyId);
  if (selection.kind === "inaccessible") redirect("/ru/access-denied");
  if (selection.kind === "ambiguous") redirect(account ? `/ru/accounts/${account.id}/companies` : "/ru/companies");
  if (selection.kind === "selected") return <CompanyProfileEditor company={selection.company} accountId={selection.company.account_id} />;
  const creationAccount = account ?? (accounts.length === 1 ? accounts[0] : null);
  if (!creationAccount) redirect("/ru/companies");
  return <CompanyProfileEditor company={null} accountId={creationAccount.id} />;
}
