import "server-only";
import { AccountAccessError, authenticatedAccountClient } from "./authorization";

export async function listAccessibleAccounts(userId: string) {
  const client = await authenticatedAccountClient(userId);
  const { data: memberships, error: membershipError } = await client.from("account_memberships").select("account_id").eq("user_id", userId).eq("role", "owner").eq("status", "active");
  if (membershipError) throw new Error("Accounts could not be loaded");
  const accountIds = (memberships ?? []).map((membership) => membership.account_id);
  if (!accountIds.length) return [];
  const { data, error } = await client.from("accounts").select("*").in("id", accountIds).eq("status", "active").order("created_at").order("id");
  if (error) throw new Error("Accounts could not be loaded");
  return data ?? [];
}

/** Compatibility default exists only when selection is unambiguous. */
export async function getOnlyAccessibleAccount(userId: string) {
  const accounts = await listAccessibleAccounts(userId);
  if (accounts.length > 1) throw new AccountAccessError("selection_required");
  if (!accounts.length) throw new AccountAccessError("not_found");
  return accounts[0];
}
