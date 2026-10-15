import "server-only";
import { AccountAccessError, requireAccountWrite, requireCompanyWrite } from "@/server/account/authorization";
import { getOnlyAccessibleAccount } from "@/server/account/queries";
import { listAccessibleCompanies } from "./queries";
import { canCreateAdditionalCompany } from "./capabilities";

/** A company URL supplies context, never authority. Recheck membership on every call. */
export async function companyCreationContext(userId: string, sourceCompanyId?: string) {
  const account = sourceCompanyId
    ? await requireAccountWrite((await requireCompanyWrite(sourceCompanyId, userId)).account_id, userId)
    : await getOnlyAccessibleAccount(userId);
  const companies = await listAccessibleCompanies(userId, account.id);
  if (companies.length && !canCreateAdditionalCompany(account)) throw new AccountAccessError("not_found");
  return { account, companies };
}
