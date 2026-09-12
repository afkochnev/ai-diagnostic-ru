import "server-only";

import { redirect } from "next/navigation";
import { requireIdentity } from "@/server/auth/session";

/**
 * The single server-side authorization boundary for administrator features.
 * requireIdentity enforces authentication, verified email, and aal2 for admins.
 */
export async function requireAdmin() {
  const identity = await requireIdentity();
  if (identity.role !== "administrator") redirect("/ru/access-denied");
  return identity;
}
