import "server-only";
import { AccountAccessError, requireAccountWrite, requireCompanyWrite } from "@/server/account/authorization";
import { getOnlyAccessibleAccount } from "@/server/account/queries";
import { listAccessibleCompanies } from "./queries";
import { canCreateAdditionalCompany } from "./capabilities";
import { requireEntitlement } from "@/server/entitlements";

/** A company URL supplies context, never authority. Recheck membership on every call. */
export async function companyCreationContext(userId: string, sourceCompanyId?: string, requestedAccountId?: string) {
  const account = sourceCompanyId
    ? await requireAccountWrite((await requireCompanyWrite(sourceCompanyId, userId)).account_id, userId)
    : requestedAccountId ? await requireAccountWrite(requestedAccountId, userId) : await getOnlyAccessibleAccount(userId);
  if (requestedAccountId && requestedAccountId !== account.id) throw new AccountAccessError("not_found");
  const companies = await listAccessibleCompanies(userId, account.id);
  if (companies.length && !canCreateAdditionalCompany(account)) throw new AccountAccessError("not_found");
  if (companies.length) await requireEntitlement(account.id, "multi_company");
  return { account, companies };
}
