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
import { AdvancedRequiredError, advancedRequiredMessage } from "@/server/entitlements";

const copy = getMessages("ru").company;
const value = (form: FormData, name: string) => String(form.get(name) ?? "");
const fields = ["name", "industry_key", "country", "products", "customer_segments", "sales_channels", "employee_count", "annual_revenue_key", "company_age_years", "management_levels", "key_problems", "main_goals"] as const;

function parsedInput(form: FormData) {
  return companyProfileSchema.safeParse(Object.fromEntries(fields.map((field) => [field, value(form, field)])));
}
function submittedValues(form: FormData): CompanyProfileState["values"] {
  return Object.fromEntries(fields.map((field) => [field, value(form, field)])) as CompanyProfileState["values"];
}
function fieldErrors(issues: { path: PropertyKey[] }[]) {
  const result: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !result[field]) result[field] = copy.fieldRequired;
  }
  return result;
}
function destination(form: FormData, companyId: string) {
  const requested = value(form, "return_to");
  const companyPath = `/ru/companies/${companyId}`;
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
  const parsed = parsedInput(form);
  const values = submittedValues(form);
  if (!parsed.success) return { error: copy.validationError, fieldErrors: fieldErrors(parsed.error.issues), values };
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
    if (error instanceof AdvancedRequiredError) return { error: advancedRequiredMessage, values };
    if (error instanceof AccountAccessError && error.code === "selection_required") redirect("/ru/companies");
    if (error instanceof AccountAccessError) return { error: copy.saveError, values };
    throw error;
  }
  const client = await createAuthClient();
  const [{ data: industry }, { data: revenue }] = await Promise.all([
    client.from("industry_translations").select("industry_key").eq("industry_key", parsed.data.industry_key).eq("locale", "ru").maybeSingle(),
    client.from("revenue_range_translations").select("revenue_key").eq("revenue_key", parsed.data.annual_revenue_key).eq("locale", "ru").maybeSingle(),
  ]);
  if (!industry) return { error: copy.invalidIndustry, fieldErrors: { industry_key: copy.invalidIndustry }, values };
  if (!revenue) return { error: copy.invalidRevenue, fieldErrors: { annual_revenue_key: copy.invalidRevenue }, values };
  const expectedRevision = Number(value(form, "revision") || "0");
  if (existing && (!Number.isInteger(expectedRevision) || expectedRevision !== existing.revision)) return { error: copy.conflictError, values };
  const payload = { ...parsed.data, revision: existing ? existing.revision + 1 : 1 };
  const result = existing
    ? await client.from("company_profiles").update(payload).eq("id", existing.id).eq("account_id", accountId).eq("revision", expectedRevision).select("id").maybeSingle()
    : await client.from("company_profiles").insert({ ...payload, account_id: accountId, owner_user_id: identity.user.id }).select("id").single();
  if (result.error || !result.data) return { error: result.error?.message === "advanced_required" ? advancedRequiredMessage : result.error?.code === "23505" ? copy.duplicateError : copy.saveError, values };
  revalidatePath("/ru/dashboard");
  revalidatePath("/ru/company-profile");
  revalidatePath("/ru/companies");
  revalidatePath(`/ru/companies/${result.data.id}`);
  revalidatePath(`/ru/companies/${result.data.id}/profile`);
  redirect(creationSource !== undefined ? `/ru/companies/${result.data.id}/profile` : destination(form, result.data.id));
}
