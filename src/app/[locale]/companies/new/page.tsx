import { redirect } from "next/navigation";
import { requireIdentity } from "@/server/auth/session";
import { AccountAccessError } from "@/server/account/authorization";
import { companyCreationContext } from "@/server/company/creation";
import { CompanyProfileEditor } from "@/features/company/company-profile-editor";

export default async function NewCompanyPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const identity = await requireIdentity();
  const { from } = await searchParams;
  let context;
  try {
    context = await companyCreationContext(identity.user.id, from);
  } catch (error) {
    if (error instanceof AccountAccessError) redirect(error.code === "selection_required" ? "/ru/companies" : "/ru/access-denied");
    throw error;
  }
  return <CompanyProfileEditor company={null} accountId={context.account.id} creationSource={from ?? null} />;
}
