"use server";
import {randomBytes} from "node:crypto";
import {headers} from "next/headers";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {requireAdmin} from "@/server/auth/admin";
import {createAuthClient} from "@/server/supabase/server";
import {authConfig} from "@/server/supabase/config";
import {adminPromoRowSchema, parsePromoInput} from "./promos";
import {sealAdminPromoCode} from "./promo-code-envelope";

export type AdminPromoState = {error?: string; success?: string; code?: string};
type PromoRpc = {rpc(name: string, args: Record<string, unknown>): Promise<{data: unknown; error: unknown}>};
const originError = "Не удалось подтвердить источник запроса. Обновите страницу.";

export async function createAdminPromo(_: AdminPromoState, form: FormData): Promise<AdminPromoState> {
  await requireAdmin();
  if ((await headers()).get("origin") !== authConfig().APP_URL) return {error: originError};
  const input = parsePromoInput(form);
  if (!input) return {error: "Укажите название от 3 до 100 символов, лимит от 1 до 1000 и дату от завтрашнего дня до года вперёд."};
  const code = `ITEAM-${randomBytes(12).toString("hex").toUpperCase()}`;
  try {
    const client = await createAuthClient() as unknown as PromoRpc;
    const ciphertext = sealAdminPromoCode(code, authConfig().AUTH_FLOW_SECRET);
    const {data, error} = await client.rpc("admin_create_advanced_promo", {p_code: code, p_label: input.label, p_max_redemptions: input.maxRedemptions, p_redeem_until: input.redeemUntil, p_code_ciphertext: ciphertext});
    if (error) return {error: "Не удалось подтвердить создание промокода. Проверьте список перед повторной попыткой."};
    const result = adminPromoRowSchema.safeParse(data);
    if (!result.success || result.data.revoked_at !== null || result.data.redemptions !== 0 || result.data.label !== input.label || result.data.max_redemptions !== input.maxRedemptions || Date.parse(result.data.redeem_until) !== Date.parse(input.redeemUntil)) return {error: "Не удалось подтвердить создание промокода. Проверьте список перед повторной попыткой."};
    revalidatePath("/ru/admin/promos");
    return {success: "Промокод создан. Его можно скопировать из списка ниже и после обновления страницы.", code};
  } catch {
    return {error: "Не удалось подтвердить создание промокода. Проверьте список перед повторной попыткой."};
  }
}

export async function revokeAdminPromo(_: AdminPromoState, form: FormData): Promise<AdminPromoState> {
  await requireAdmin();
  if ((await headers()).get("origin") !== authConfig().APP_URL) return {error: originError};
  const parsed = z.uuid().safeParse(form.get("promo_id"));
  if (!parsed.success) return {error: "Промокод не найден. Обновите страницу."};
  try {
    const client = await createAuthClient() as unknown as PromoRpc;
    const {data, error} = await client.rpc("admin_revoke_advanced_promo", {p_promo_id: parsed.data});
    const result = z.object({id: z.uuid(), revoked_at: z.iso.datetime({offset: true})}).safeParse(data);
    if (error || !result.success || result.data.id !== parsed.data) return {error: "Не удалось отключить промокод. Обновите страницу и проверьте его статус."};
    revalidatePath("/ru/admin/promos");
    return {success: "Новые активации отключены. Уже выданный доступ сохранён."};
  } catch {
    return {error: "Не удалось отключить промокод. Обновите страницу и проверьте его статус."};
  }
}

export async function deleteAdminPromo(_: AdminPromoState, form: FormData): Promise<AdminPromoState> {
  await requireAdmin();
  if ((await headers()).get("origin") !== authConfig().APP_URL) return {error: originError};
  const parsed = z.uuid().safeParse(form.get("promo_id"));
  if (!parsed.success) return {error: "Промокод не найден. Обновите страницу."};
  try {
    const client = await createAuthClient() as unknown as PromoRpc;
    const {data, error} = await client.rpc("admin_delete_advanced_promo", {p_promo_id: parsed.data});
    const result = z.object({id: z.uuid(), deleted_at: z.iso.datetime({offset: true})}).safeParse(data);
    if (error || !result.success || result.data.id !== parsed.data) return {error: "Не удалось удалить промокод. Обновите страницу и проверьте список."};
    revalidatePath("/ru/admin/promos");
    return {success: "Промокод удалён из списка. Уже выданный доступ сохранён."};
  } catch {
    return {error: "Не удалось удалить промокод. Обновите страницу и проверьте список."};
  }
}
