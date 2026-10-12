import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createAuthClient } from "@/server/supabase/server";
import { isAuthConfigured } from "@/server/supabase/config";
import { listAccessibleAccounts } from "@/server/account/queries";
import { listAccessibleCompanies } from "@/server/company/queries";
import { workspaceDestination } from "@/features/company/workspace-routing";

export { workspaceDestination } from "@/features/company/workspace-routing";

export const getIdentity = cache(async () => {
  if (!isAuthConfigured()) return null;
  const client = await createAuthClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  if (!user.email_confirmed_at) return { user, role: null, aal: null };
  const { data: role } = await client.from("user_roles").select("role").eq("user_id", user.id).single();
  // Missing role also covers revoked sessions, denied by RLS.
  if (!role) return null;
  const { data: assurance } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  return { user, role: role.role, aal: assurance?.currentLevel ?? null };
});

export async function requireIdentity() {
  const identity = await getIdentity();
  if (!identity) redirect("/ru/login");
  if (!identity.user.email_confirmed_at) redirect("/ru/verify-email");
  if (identity.role === "administrator" && identity.aal !== "aal2") redirect("/ru/mfa");
  return identity;
}

export async function signedInDestination() {
  const identity = await getIdentity();
  if (!identity) return "/ru/login";
  if (!identity.user.email_confirmed_at) return "/ru/verify-email";
  if (identity.role === "administrator") return identity.aal === "aal2" ? "/ru/admin" : "/ru/mfa";
  const [companies, accounts] = await Promise.all([listAccessibleCompanies(identity.user.id), listAccessibleAccounts(identity.user.id)]);
  return workspaceDestination(companies.length, accounts.length);
}
