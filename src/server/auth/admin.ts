import "server-only";

import { redirect } from "next/navigation";
import {cache} from "react";
import { getIdentity } from "@/server/auth/session";
import {createAuthClient} from "@/server/supabase/server";
import {z} from "zod";

/**
 * The single server-side authorization boundary for administrator features.
 * Owner-approved V2.4 policy: verified live administrator session, without
 * mandatory AAL2 in Admin Console. Ordinary requireIdentity remains unchanged.
 */
export const requireAdmin=cache(async () => {
  const identity = await getIdentity();
  if(!identity)redirect("/ru/login");
  if(!identity.user.email_confirmed_at)redirect("/ru/verify-email");
  if (identity.role !== "administrator") redirect("/ru/access-denied");
  const client=await createAuthClient();
  const {data,error}=await client.rpc("read_admin_console",{p_section:"identity"});
  if(error||!z.object({administrator:z.literal(true)}).safeParse(data).success)redirect("/ru/access-denied");
  return identity;
});
