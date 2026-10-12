import "server-only";
import { createAuthClient } from "@/server/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AccountAccessError extends Error {
  constructor(public readonly code: "not_found" | "selection_required") { super(code); }
}

/** Bind caller-supplied identity to the verified cookie session before any lookup. */
export async function authenticatedAccountClient(userId: string) {
  const client = await createAuthClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || user.id !== userId || !user.email_confirmed_at) throw new AccountAccessError("not_found");
  return client;
}

export async function requireAccountRead(accountId: string, userId: string) {
  if (!UUID.test(accountId)) throw new AccountAccessError("not_found");
  const client = await authenticatedAccountClient(userId);
  const { data: membership, error: membershipError } = await client.from("account_memberships").select("account_id").eq("account_id", accountId).eq("user_id", userId).eq("role", "owner").eq("status", "active").maybeSingle();
  if (membershipError || !membership) throw new AccountAccessError("not_found");
  const { data: account, error } = await client.from("accounts").select("*").eq("id", accountId).eq("status", "active").maybeSingle();
  if (error || !account) throw new AccountAccessError("not_found");
  return account;
}

// Owner is the sole account role in this stage; read and write share authority.
export const requireAccountWrite = requireAccountRead;

export async function requireCompanyRead(companyId: string, userId: string) {
  if (!UUID.test(companyId)) throw new AccountAccessError("not_found");
  const client = await authenticatedAccountClient(userId);
  const { data: company, error } = await client.from("company_profiles").select("*").eq("id", companyId).maybeSingle();
  if (error || !company?.account_id) throw new AccountAccessError("not_found");
  await requireAccountRead(company.account_id, userId);
  return company;
}

export const requireCompanyWrite = requireCompanyRead;

export async function requireDiagnosticRead(diagnosticId: string, userId: string) {
  if (!UUID.test(diagnosticId)) throw new AccountAccessError("not_found");
  const client = await authenticatedAccountClient(userId);
  const { data: diagnostic, error } = await client.from("diagnostics").select("*").eq("id", diagnosticId).maybeSingle();
  if (error || !diagnostic) throw new AccountAccessError("not_found");
  await requireCompanyRead(diagnostic.company_id, userId);
  return diagnostic;
}

export const requireDiagnosticWrite = requireDiagnosticRead;
