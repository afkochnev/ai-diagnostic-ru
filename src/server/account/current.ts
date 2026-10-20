import "server-only";
import { listAccessibleAccounts } from "./queries";

/** Context is never authority: candidates already passed active membership checks. */
export function selectCurrentAccount<T extends { id: string; legacy_origin_user_id?: string | null }>(accounts: readonly T[], userId: string, requested?: string) {
  if (requested !== undefined) {
    const account = accounts.find(({ id }) => id === requested);
    return account ? { kind: "selected" as const, account } : { kind: "denied" as const };
  }
  const personal = accounts.filter(account => account.legacy_origin_user_id === userId);
  if (personal.length === 1) return { kind: "selected" as const, account: personal[0] };
  if (accounts.length === 1) return { kind: "selected" as const, account: accounts[0] };
  return { kind: accounts.length ? "ambiguous" as const : "missing" as const };
}

export async function getCurrentAccount(userId: string, requested?: string) {
  return selectCurrentAccount(await listAccessibleAccounts(userId), userId, requested);
}
