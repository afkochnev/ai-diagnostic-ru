"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAuthClient } from "@/server/supabase/server";
import { requireIdentity } from "@/server/auth/session";
import { companyProfileSchema, type CompanyProfileState } from "@/validation/company";
import { getMessages } from "@/i18n/messages";

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
function destination(form: FormData) {
  const requested = value(form, "return_to");
  return requested === "/ru/dashboard" ? requested : "/ru/dashboard";
}

export async function saveCompanyProfileAction(_: CompanyProfileState, form: FormData): Promise<CompanyProfileState> {
  const identity = await requireIdentity();
  const parsed = parsedInput(form);
  const values = submittedValues(form);
  if (!parsed.success) return { error: copy.validationError, fieldErrors: fieldErrors(parsed.error.issues), values };
  const client = await createAuthClient();
  const [{ data: industry }, { data: revenue }] = await Promise.all([
    client.from("industry_translations").select("industry_key").eq("industry_key", parsed.data.industry_key).eq("locale", "ru").maybeSingle(),
    client.from("revenue_range_translations").select("revenue_key").eq("revenue_key", parsed.data.annual_revenue_key).eq("locale", "ru").maybeSingle(),
  ]);
  if (!industry) return { error: copy.invalidIndustry, fieldErrors: { industry_key: copy.invalidIndustry }, values };
  if (!revenue) return { error: copy.invalidRevenue, fieldErrors: { annual_revenue_key: copy.invalidRevenue }, values };
  const { data: existing, error: readError } = await client.from("company_profiles").select("id, revision").eq("owner_user_id", identity.user.id).maybeSingle();
  if (readError) return { error: copy.saveError, values };
  const expectedRevision = Number(value(form, "revision") || "0");
  if (existing && expectedRevision > 0 && expectedRevision !== existing.revision) return { error: copy.conflictError, values };
  const payload = { ...parsed.data, owner_user_id: identity.user.id, revision: existing ? existing.revision + 1 : 1 };
  const result = existing
    ? await client.from("company_profiles").update(payload).eq("id", existing.id).eq("owner_user_id", identity.user.id).eq("revision", existing.revision).select("id").maybeSingle()
    : await client.from("company_profiles").insert(payload).select("id").single();
  if (result.error || !result.data) return { error: result.error?.code === "23505" ? copy.duplicateError : copy.saveError, values };
  revalidatePath("/ru/dashboard");
  revalidatePath("/ru/company-profile");
  redirect(destination(form));
}
