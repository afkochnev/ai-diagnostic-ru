"use server";

import {headers} from "next/headers";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {z} from "zod";
import {requireIdentity} from "@/server/auth/session";
import {accountPlanMfaReturnTo} from "@/server/auth/mfa-return";
import {requireAccountWrite, requireCompanyWrite} from "@/server/account/authorization";
import {createAuthClient} from "@/server/supabase/server";
import {authConfig} from "@/server/supabase/config";
import {enforceRateLimit, RateLimitExceeded} from "@/server/rate-limit";
import {getAccountPlan} from "@/server/entitlements";

export type PromoActionState = {error?: string; success?: string; continueHref?: string};
const inputSchema = z.object({
  account: z.uuid(),
  company: z.uuid().nullable(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{8,64}$/),
});
const resultSchema = z.object({
  status: z.enum(["activated", "already_redeemed", "already_advanced", "invalid", "rate_limited", "billing_managed"]),
  effective_until: z.iso.datetime({offset: true}).nullable().optional(),
});

export async function redeemAdvancedPromo(_: PromoActionState, form: FormData): Promise<PromoActionState> {
  if ((await headers()).get("origin") !== authConfig().APP_URL) {
    return {error: "Не удалось подтвердить источник запроса. Обновите страницу."};
  }
  const identity = await requireIdentity(accountPlanMfaReturnTo(form.get("account"), form.get("company")));
  const parsed = inputSchema.safeParse({account: form.get("account"), company: form.get("company") || null, code: form.get("code")});
  if (!parsed.success) return {error: "Проверьте промокод и попробуйте ещё раз."};
  const {account, company, code} = parsed.data;
  let outcome: z.infer<typeof resultSchema>;
  try {
    await requireAccountWrite(account, identity.user.id);
    if (company && (await requireCompanyWrite(company, identity.user.id)).account_id !== account) {
      return {error: "Компания не относится к выбранному аккаунту. Откройте её из кабинета."};
    }
    await enforceRateLimit(`promo:${identity.user.id}`, 10, 900);
    const client = await createAuthClient();
    const {data, error} = await (client as unknown as {
      rpc(name: string, args: Record<string, string>): Promise<{data: unknown; error: unknown}>;
    }).rpc("redeem_advanced_promo", {p_account_id: account, p_code: code});
    if (error) return {error: "Не удалось активировать промокод. Попробуйте позже."};
    const result = resultSchema.safeParse(data);
    if (!result.success) return {error: "Не удалось подтвердить активацию. Обновите страницу и проверьте тариф."};
    outcome = result.data;
  } catch (error) {
    return {error: error instanceof RateLimitExceeded
      ? "Слишком много попыток. Попробуйте через 15 минут."
      : "Не удалось активировать промокод. Проверьте доступ к аккаунту и попробуйте позже."};
  }
  if (outcome.status === "invalid") return {error: "Промокод не действует: проверьте написание, срок или запросите новый код у организатора тестирования."};
  if (outcome.status === "rate_limited") return {error: "Слишком много попыток. Попробуйте через 15 минут."};
  if (outcome.status === "billing_managed") return {error: "Этот аккаунт связан с оплатой. Для подключения тестового доступа напишите на info@iteam.ru."};
  if (outcome.status === "already_redeemed" && (!outcome.effective_until || Date.parse(outcome.effective_until) <= Date.now())) {
    return {error: "Этот промокод уже использован, и срок тестового доступа завершился. Запросите новый код у организатора тестирования."};
  }
  if (outcome.status === "activated" && (!outcome.effective_until || Date.parse(outcome.effective_until) <= Date.now())) {
    return {error: "Не удалось подтвердить срок доступа. Обновите страницу и проверьте тариф."};
  }
  try {
    if (!(await getAccountPlan(account)).entitlements.team_diagnostics) {
      return {error: "Тестовый доступ по этому промокоду уже использован и больше не действует. Запросите новый код у организатора тестирования."};
    }
  } catch {
    return {error: "Не удалось подтвердить доступ. Обновите страницу и проверьте тариф перед повторной попыткой."};
  }
  revalidatePath("/ru/account/plan");
  revalidatePath(`/ru/accounts/${account}/companies`);
  if (company) {
    revalidatePath(`/ru/companies/${company}`);
    revalidatePath(`/ru/companies/${company}/diagnostics`);
    redirect(`/ru/companies/${company}/diagnostics?new=1&type=team#team-create`);
  }
  const until = outcome.effective_until ? new Date(outcome.effective_until).toLocaleDateString("ru-RU", {timeZone: "Europe/Moscow"}) : null;
  return {
    success: outcome.status === "already_advanced" ? "Advanced уже подключён. Промокод не использован."
      : `${outcome.status === "already_redeemed" ? "Промокод уже активирован." : "Advanced подключён бесплатно."}${until ? ` Доступ действует до ${until}.` : ""}`,
    continueHref: `/ru/accounts/${account}/companies`,
  };
}
