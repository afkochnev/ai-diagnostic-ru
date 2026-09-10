import "server-only";
import { createAuthClient } from "@/server/supabase/server";

export async function getReferenceData() {
  const client = await createAuthClient();
  const [{ data: industryRows }, { data: revenueRows }] = await Promise.all([
    client.from("industries").select("key, sort_order, industry_translations!inner(name)").eq("is_active", true).eq("industry_translations.locale", "ru").order("sort_order"),
    client.from("revenue_ranges").select("key, sort_order, revenue_range_translations!inner(name)").eq("is_active", true).eq("revenue_range_translations.locale", "ru").order("sort_order"),
  ]);
  return {
    industries: (industryRows ?? []).map((row) => ({ industry_key: row.key, name: row.industry_translations[0]?.name ?? row.key })),
    revenues: (revenueRows ?? []).map((row) => ({ revenue_key: row.key, name: row.revenue_range_translations[0]?.name ?? row.key })),
  };
}

export async function getOwnCompany(userId: string) {
  const client = await createAuthClient();
  const { data, error } = await client.from("company_profiles").select("*").eq("owner_user_id", userId).maybeSingle();
  if (error) throw new Error("Company profile could not be loaded");
  return data;
}

export async function getCompanyForOwner(companyId: string, userId: string) {
  const client = await createAuthClient();
  const { data, error } = await client.from("company_profiles").select("*").eq("id", companyId).eq("owner_user_id", userId).maybeSingle();
  if (error) throw new Error("Company profile could not be loaded");
  return data;
}
