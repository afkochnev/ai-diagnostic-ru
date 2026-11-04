import { localizedPath } from "@/i18n/pilot-copy";
import { requestLocale } from "@/server/locale";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/server/auth/session";
import { AccountAccessError } from "@/server/account/authorization";
import { companyCreationContext } from "@/server/company/creation";
import { CompanyProfileEditor } from "@/features/company/company-profile-editor";
import { AdvancedRequiredError } from "@/server/entitlements";

export default async function NewCompanyPage({ searchParams }: { searchParams: Promise<{ from?: string; account?: string }> }) {
  const locale = await requestLocale();

  const identity = await requireIdentity();
  const { from, account } = await searchParams;
  let context;
  try {
    context = await companyCreationContext(identity.user.id, from, account);
  } catch (error) {
    if (error instanceof AdvancedRequiredError) redirect(locale === "en" ? "/en/companies" : `/ru/account/plan?account=${error.accountId}`);
    if (error instanceof AccountAccessError) redirect(error.code === "selection_required" ? localizedPath(locale, "/ru/companies") : localizedPath(locale, "/ru/access-denied"));
    throw error;
  }
  return <CompanyProfileEditor company={null} accountId={context.account.id} creationSource={from ?? null} creationAccountId={context.account.id} />;
}
