import "server-only";
import { createAuthClient } from "@/server/supabase/server";
import { listAccessibleAccounts } from "@/server/account/queries";
import { AccountAccessError, authenticatedAccountClient, requireAccountRead, requireCompanyRead } from "@/server/account/authorization";

export async function getReferenceData() {
  const client = await createAuthClient();
  const [{ data: industryRows }, { data: revenueRows }] = await Promise.all([
    client.from("industries").select("key, sort_order, industry_translations!inner(name)").eq("is_active", true).eq("industry_translations.locale", "ru").order("sort_order"),
    client.from("revenue_ranges").select("key, sort_order, revenue_range_translations!inner(name)").eq("is_active", true).eq("revenue_range_translations.locale", "ru").order("sort_order"),
  ]);
  return {
    industries: (industryRows ?? []).map((row) => ({ industry_key: row.key, name: row.industry_translations[0]?.name ?? row.key })),
    revenues: (revenueRows ?? []).map((row) => ({ revenue_key: row.key, name: row.revenue_range_translations[0]?.name ?? row.key })),
  };
}

export async function listAccessibleCompanies(userId: string, accountId?: string) {
  const accounts = accountId ? [await requireAccountRead(accountId, userId)] : await listAccessibleAccounts(userId);
  if (!accounts.length) return [];
  const client = await authenticatedAccountClient(userId);
  const { data, error } = await client.from("company_profiles").select("*").in("account_id", accounts.map((account) => account.id)).order("created_at").order("id");
  if (error) throw new Error("Company profile could not be loaded");
  return data ?? [];
}

export async function getOwnCompany(userId: string) {
  const companies = await listAccessibleCompanies(userId);
  if (companies.length > 1) throw new AccountAccessError("selection_required");
  return companies.length ? companies[0] : null;
}

export async function getCompanyForAccount(accountId: string, companyId: string, userId: string) {
  await requireAccountRead(accountId, userId);
  const company = await requireCompanyRead(companyId, userId);
  if (company.account_id !== accountId) throw new AccountAccessError("not_found");
  return company;
}

/** Legacy name retained for old callers; current membership is the authority. */
export const getCompanyForOwner = requireCompanyRead;
