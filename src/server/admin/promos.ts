import "server-only";
import {z} from "zod";
import {requireAdmin} from "@/server/auth/admin";
import {createAuthClient} from "@/server/supabase/server";
import {authConfig} from "@/server/supabase/config";
import {openAdminPromoCode} from "./promo-code-envelope";

const dayMs = 86400000;
const isoDate = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
export function promoDateBounds(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {minimum: isoDate(today + dayMs), maximum: isoDate(today + 365 * dayMs), initial: isoDate(today + 30 * dayMs)};
}

const inputSchema = z.object({label: z.string().trim().min(3).max(100), max_redemptions: z.coerce.number().int().min(1).max(1000), redeem_until: z.iso.date()});
export function parsePromoInput(form: FormData, now = new Date()) {
  const parsed = inputSchema.safeParse(Object.fromEntries(["label", "max_redemptions", "redeem_until"].map(key => [key, form.get(key)])));
  if (!parsed.success) return null;
  const bounds = promoDateBounds(now);
  if (parsed.data.redeem_until < bounds.minimum || parsed.data.redeem_until > bounds.maximum) return null;
  // The selected date is inclusive; the database stores an exclusive UTC boundary.
  const redeemUntil = new Date(Date.parse(`${parsed.data.redeem_until}T00:00:00.000Z`) + dayMs).toISOString();
  return {label: parsed.data.label, maxRedemptions: parsed.data.max_redemptions, redeemUntil};
}

export const adminPromoRowSchema = z.object({
  id: z.uuid(), label: z.string().min(3).max(100), code_hint: z.string().min(1).max(16),
  max_redemptions: z.number().int().min(1).max(1000), redemptions: z.number().int().nonnegative(),
  redeem_until: z.iso.datetime({offset: true}), revoked_at: z.iso.datetime({offset: true}).nullable(), created_at: z.iso.datetime({offset: true}),
});
const storedPromoRowSchema = adminPromoRowSchema.extend({
  code_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  code_ciphertext: z.string().max(256).nullable().optional(),
});
export type AdminPromoRow = z.infer<typeof adminPromoRowSchema> & {code: string | null; codeStatus: "available" | "legacy" | "unavailable"};
type PromoRpc = {rpc(name: string, args?: Record<string, unknown>): Promise<{data: unknown; error: unknown}>};

export async function listAdminPromos() {
  await requireAdmin();
  const client = await createAuthClient() as unknown as PromoRpc;
  const {data, error} = await client.rpc("admin_list_advanced_promos");
  if (error) throw new Error("admin_promos_unavailable");
  const stored = z.object({rows: z.array(storedPromoRowSchema).max(25)}).parse(data).rows;
  const secret = authConfig().AUTH_FLOW_SECRET;
  // Only verified administrators receive the decrypted display code. Neither the
  // hash nor the encrypted payload crosses the server/client boundary.
  const rows: AdminPromoRow[] = stored.map(({code_ciphertext, code_hash, ...row}) => {
    const code = openAdminPromoCode(code_ciphertext, code_hash, secret);
    return {...row, code, codeStatus: code ? "available" : code_ciphertext ? "unavailable" : "legacy"};
  });
  return {rows, readAt: Date.now()};
}
