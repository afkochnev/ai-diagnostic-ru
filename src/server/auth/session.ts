import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createAuthClient } from "@/server/supabase/server";
import { isAuthConfigured } from "@/server/supabase/config";
import { listAccessibleAccounts } from "@/server/account/queries";
import { listAccessibleCompanies } from "@/server/company/queries";
import { workspaceDestination } from "@/features/company/workspace-routing";
import {safeMfaReturnTo} from "./mfa-return";

export { workspaceDestination } from "@/features/company/workspace-routing";

export const getIdentity = cache(async () => {
  if (!isAuthConfigured()) return null;
  const client = await createAuthClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  if (!user.email_confirmed_at) return { user, role: null, aal: null, nextAal: null };
  const { data: role } = await client.from("user_roles").select("role").eq("user_id", user.id).single();
  // Missing role also covers revoked sessions, denied by RLS.
  if (!role) return null;
  const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || !assurance) return null;
  return { user, role: role.role, aal: assurance.currentLevel, nextAal: assurance.nextLevel };
});

export async function requireIdentity(returnTo?: string) {
  const identity = await getIdentity();
  if (!identity) redirect("/ru/login");
  if (!identity.user.email_confirmed_at) redirect("/ru/verify-email");
  // A configured MFA factor requires step-up; the administrator role alone does not.
  if (identity.role === "administrator" && identity.nextAal === "aal2" && identity.aal !== "aal2") {
    const next = safeMfaReturnTo(returnTo);
    redirect(next ? `/ru/mfa?next=${encodeURIComponent(next)}` : "/ru/mfa");
  }
  return identity;
}

export async function signedInDestination() {
  const identity = await getIdentity();
  if (!identity) return "/ru/login";
  if (!identity.user.email_confirmed_at) return "/ru/verify-email";
  if (identity.role === "administrator") return "/ru/admin";
  const [companies, accounts] = await Promise.all([listAccessibleCompanies(identity.user.id), listAccessibleAccounts(identity.user.id)]);
  return workspaceDestination(companies.length, accounts.length);
}
