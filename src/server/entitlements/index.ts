import "server-only";
import { z } from "zod";
import { createAuthClient } from "@/server/supabase/server";

export const entitlementKeys = ["multi_company", "team_diagnostics"] as const;
export type Entitlement = typeof entitlementKeys[number];
const accountPlan = z.strictObject({
  plan: z.enum(["free", "advanced"]), display_name: z.enum(["Free", "Advanced"]),
  entitlements: z.strictObject({ multi_company: z.boolean(), team_diagnostics: z.boolean() }),
});
export type AccountPlan = z.infer<typeof accountPlan>;
export class AdvancedRequiredError extends Error {
  constructor(public readonly accountId: string) { super("advanced_required"); }
}
export const advancedRequiredMessage = "Эта возможность доступна на тарифе Advanced.";

/** Fresh cookie-authenticated RPC; no global-role or client-plan authority. */
export async function getAccountPlan(accountId: string): Promise<AccountPlan> {
  const client = await createAuthClient();
  const rpc = client as unknown as { rpc(name: string, args: Record<string, string>): Promise<{ data: unknown; error: unknown }> };
  const { data, error } = await rpc.rpc("read_account_plan", { p_account_id: accountId });
  if (error) throw new Error("account_plan_unavailable");
  const result = accountPlan.safeParse(data);
  if (!result.success) throw new Error("account_plan_unavailable");
  return result.data;
}
export async function hasEntitlement(accountId: string, key: string): Promise<boolean> {
  if (!entitlementKeys.includes(key as Entitlement)) return false;
  try { return (await getAccountPlan(accountId)).entitlements[key as Entitlement]; }
  catch { return false; }
}
export async function requireEntitlement(accountId: string, key: Entitlement) {
  if (!await hasEntitlement(accountId, key)) throw new AdvancedRequiredError(accountId);
}
