"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAuthClient } from "@/server/supabase/server";
import { requireIdentity } from "@/server/auth/session";
import { companyProfileSchema, type CompanyProfileState } from "@/validation/company";
import { getMessages } from "@/i18n/messages";
import { AccountAccessError, requireAccountWrite, requireCompanyWrite } from "@/server/account/authorization";
import { getOwnCompany } from "./queries";
import { companyCreationContext } from "./creation";
import {formLocale} from "@/server/locale";
import type {Locale} from "@/i18n/config";
import { AdvancedRequiredError, advancedRequiredMessage } from "@/server/entitlements";

const value = (form: FormData, name: string) => String(form.get(name) ?? "");
const fields = ["name", "industry_key", "country", "products", "customer_segments", "sales_channels", "employee_count", "annual_revenue_key", "company_age_years", "management_levels", "key_problems", "main_goals"] as const;

function parsedInput(form: FormData) {
  return companyProfileSchema.safeParse(Object.fromEntries(fields.map((field) => [field, value(form, field)])));
}
function submittedValues(form: FormData): CompanyProfileState["values"] {
  return Object.fromEntries(fields.map((field) => [field, value(form, field)])) as CompanyProfileState["values"];
}
function fieldErrors(issues: { path: PropertyKey[] }[], locale: Locale) {
  const copy = getMessages(locale).company;
  const result: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !result[field]) result[field] = copy.fieldRequired;
  }
  return result;
}
function destination(form: FormData, companyId: string) {
  const requested = value(form, "return_to");
  const companyPath = `/${formLocale(form)}/companies/${companyId}`;
  return [companyPath, `${companyPath}/diagnostics`].includes(requested) ? requested : companyPath;
}

export async function saveCompanyProfileAction(_: CompanyProfileState, form: FormData): Promise<CompanyProfileState> {
  return saveProfile(form);
}

export async function createCompanyProfileAction(sourceCompanyId: string | null, _: CompanyProfileState, form: FormData): Promise<CompanyProfileState> {
  return saveProfile(form, sourceCompanyId);
}

export async function createCompanyForAccountAction(accountId: string, sourceCompanyId: string | null, _: CompanyProfileState, form: FormData): Promise<CompanyProfileState> {
  return saveProfile(form, sourceCompanyId, accountId);
}

async function saveProfile(form: FormData, creationSource?: string | null, creationAccountId?: string): Promise<CompanyProfileState> {
  const identity = await requireIdentity();
  const locale = formLocale(form);
  const copy = getMessages(locale).company;
  const advancedMessage = locale === "en" ? "Additional companies require Advanced. Contact us to arrange another pilot." : advancedRequiredMessage;
  const parsed = parsedInput(form);
  const values = submittedValues(form);
  if (!parsed.success) return { error: copy.validationError, fieldErrors: fieldErrors(parsed.error.issues, locale), values };
  let existing;
  let accountId: string;
  try {
    const companyId = value(form, "company_id");
    const requestedAccountId = value(form, "account_id");
    if (creationSource !== undefined && companyId) throw new AccountAccessError("not_found");
    existing = creationSource !== undefined ? null : companyId ? await requireCompanyWrite(companyId, identity.user.id) : await getOwnCompany(identity.user.id);
    if (existing) {
      accountId = existing.account_id;
      if (requestedAccountId && requestedAccountId !== accountId) throw new AccountAccessError("not_found");
      await requireAccountWrite(accountId, identity.user.id);
    } else {
      const { account } = await companyCreationContext(identity.user.id, creationSource ?? undefined, creationAccountId);
      if (requestedAccountId && requestedAccountId !== account.id) throw new AccountAccessError("not_found");
      accountId = account.id;
    }
  } catch (error) {
    if (error instanceof AdvancedRequiredError) return { error: advancedMessage, values };
    if (error instanceof AccountAccessError && error.code === "selection_required") redirect(`/${locale}/companies`);
    if (error instanceof AccountAccessError) return { error: copy.saveError, values };
    throw error;
  }
  const client = await createAuthClient();
  const [{ data: industry }, { data: revenue }] = await Promise.all([
    client.from("industry_translations").select("industry_key").eq("industry_key", parsed.data.industry_key).eq("locale", locale).maybeSingle(),
    parsed.data.annual_revenue_key ? client.from("revenue_range_translations").select("revenue_key").eq("revenue_key", parsed.data.annual_revenue_key).eq("locale", "ru").maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!industry) return { error: copy.invalidIndustry, fieldErrors: { industry_key: copy.invalidIndustry }, values };
  if (locale === "ru" && parsed.data.annual_revenue_key && !revenue) return { error: copy.invalidRevenue, fieldErrors: { annual_revenue_key: copy.invalidRevenue }, values };
  const expectedRevision = Number(value(form, "revision") || "0");
  if (existing && (!Number.isInteger(expectedRevision) || expectedRevision !== existing.revision)) return { error: copy.conflictError, values };
  const payload = { ...parsed.data, ...(locale === "en" ? { annual_revenue_key: existing?.annual_revenue_key ?? null } : {}), revision: existing ? existing.revision + 1 : 1 };
  const result = existing
    ? await client.from("company_profiles").update(payload).eq("id", existing.id).eq("account_id", accountId).eq("revision", expectedRevision).select("id").maybeSingle()
    : await client.from("company_profiles").insert({ ...payload, account_id: accountId, owner_user_id: identity.user.id }).select("id").single();
  if (result.error || !result.data) return { error: result.error?.message === "advanced_required" ? advancedMessage : result.error?.code === "23505" ? copy.duplicateError : copy.saveError, values };
  revalidatePath(`/${locale}/dashboard`);
  revalidatePath(`/${locale}/company-profile`);
  revalidatePath(`/${locale}/companies`);
  revalidatePath(`/${locale}/companies/${result.data.id}`);
  revalidatePath(`/${locale}/companies/${result.data.id}/profile`);
  redirect(!existing ? `/${locale}/companies/${result.data.id}/diagnostics?new=1#choose` : destination(form, result.data.id));
}
