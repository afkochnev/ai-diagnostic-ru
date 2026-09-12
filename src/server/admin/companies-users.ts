import "server-only";

import { requireAdmin } from "@/server/auth/admin";
import { createAdminClient } from "@/server/supabase/admin";

const PAGE_SIZE = 20;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pageOf = (value?: string) => Math.max(1, Math.min(10_000, Number.parseInt(value ?? "1", 10) || 1));
const text = (value?: string) => value?.trim().slice(0, 100);
type Filters = { q?: string; country?: string; industry?: string; company?: string; hasDiagnostics?: string; page?: string };

export async function getAdminCompanies(filters: Filters = {}) {
  await requireAdmin();
  const db = createAdminClient();
  const page = pageOf(filters.page);
  let query = db.from("company_profiles").select("id,name,country,industry_key,employee_count,company_age_years,created_at", { count: "exact" });
  const q = text(filters.q);
  if (q) query = query.ilike("name", `%${q}%`);
  if (filters.country) query = query.eq("country", text(filters.country));
  if (filters.industry) query = query.eq("industry_key", text(filters.industry));
  if (filters.hasDiagnostics === "yes" || filters.hasDiagnostics === "no") {
    const { data: diagnosticCompanies } = await db.from("diagnostics").select("company_id");
    const ids = [...new Set((diagnosticCompanies ?? []).map((row) => row.company_id))];
    if (filters.hasDiagnostics === "yes") query = ids.length ? query.in("id", ids) : query.eq("id", "00000000-0000-0000-0000-000000000000");
    else if (ids.length) query = query.not("id", "in", `(${ids.join(",")})`);
  }
  const { data: companies, count, error } = await query.order("name").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw new Error("Admin companies query failed");
  const rows = companies ?? [];
  if (!rows.length) return { rows: [], page, pageSize: PAGE_SIZE, total: count ?? 0, totalPages: 1, filters };
  const ids = rows.map((row) => row.id);
  const [{ data: owners }, { data: diagnostics }, { data: industries }] = await Promise.all([
    db.from("company_profiles").select("id,owner_user_id").in("id", ids),
    db.from("diagnostics").select("id,company_id").in("company_id", ids),
    db.from("industry_translations").select("industry_key,name").eq("locale", "ru").in("industry_key", rows.map((row) => row.industry_key)),
  ]);
  const ownerCount = new Map((owners ?? []).map((row) => [row.id, row.owner_user_id ? 1 : 0]));
  const diagnosticCount = countBy(diagnostics ?? [], "company_id");
  const industryMap = new Map((industries ?? []).map((row) => [row.industry_key, row.name]));
  const mapped = rows.map((row) => ({ ...row, industryLabel: industryMap.get(row.industry_key) ?? "Не указано", userCount: ownerCount.get(row.id) ?? 0, diagnosticCount: diagnosticCount.get(row.id) ?? 0 }));
  return { rows: mapped, page, pageSize: PAGE_SIZE, total: count ?? mapped.length, totalPages: Math.max(1, Math.ceil((count ?? mapped.length) / PAGE_SIZE)), filters };
}

export async function getAdminCompanyDetail(companyId: string) {
  await requireAdmin();
  if (!uuid.test(companyId)) return null;
  const db = createAdminClient();
  const { data: company } = await db.from("company_profiles").select("id,name,country,industry_key,employee_count,company_age_years,annual_revenue_key,management_levels,products,customer_segments,sales_channels,main_goals,key_problems,created_at,owner_user_id").eq("id", companyId).maybeSingle();
  if (!company) return null;
  const [{ data: users }, { data: diagnostics }, { data: industry }, { data: revenue }, authUsers] = await Promise.all([
    db.from("users").select("id,full_name,phone,created_at").eq("id", company.owner_user_id).order("full_name"),
    db.from("diagnostics").select("id,created_by_user_id,status,started_at,completed_at").eq("company_id", companyId).order("started_at", { ascending: false }),
    db.from("industry_translations").select("name").eq("industry_key", company.industry_key).eq("locale", "ru").maybeSingle(),
    db.from("revenue_range_translations").select("name").eq("revenue_key", company.annual_revenue_key).eq("locale", "ru").maybeSingle(),
    loadAuthUsers(),
  ]);
  const diagnosticIds = (diagnostics ?? []).map((row) => row.id);
  const { data: results } = diagnosticIds.length ? await db.from("diagnostic_results").select("diagnostic_id,display_manageability_index,maturity_level_id").in("diagnostic_id", diagnosticIds) : { data: [] };
  const maturityIds = (results ?? []).map((row) => row.maturity_level_id).filter(Boolean);
  const { data: levels } = maturityIds.length ? await db.from("maturity_level_translations").select("maturity_level_id,label").in("maturity_level_id", maturityIds).eq("locale", "ru") : { data: [] };
  const resultMap = new Map((results ?? []).map((row) => [row.diagnostic_id, row])); const levelMap = new Map((levels ?? []).map((row) => [row.maturity_level_id, row.label])); const emailMap = new Map(authUsers.map((user) => [user.id, user.email]));
  return { company: { ...company, industryLabel: industry?.name ?? "Не указано", revenueLabel: revenue?.name ?? "Не указано" }, users: (users ?? []).map((user) => ({ ...user, email: emailMap.get(user.id) ?? null })), diagnostics: (diagnostics ?? []).map((diagnostic) => ({ ...diagnostic, result: resultMap.get(diagnostic.id) ? { ...resultMap.get(diagnostic.id), maturityLabel: levelMap.get(resultMap.get(diagnostic.id)!.maturity_level_id) ?? null } : null })) };
}

export async function getAdminUsers(filters: Filters = {}) {
  await requireAdmin();
  const db = createAdminClient();
  const page = pageOf(filters.page);
  const q = text(filters.q);
  const authUsers = await loadAuthUsers();
  const emailMap = new Map(authUsers.map((user) => [user.id, user.email]));
  const emailIds = q ? authUsers.filter((user) => user.email?.toLowerCase().includes(q.toLowerCase())).map((user) => user.id) : [];
  let query = db.from("users").select("id,full_name,phone,created_at", { count: "exact" });
  if (q) query = query.or([`full_name.ilike.%${q}%`, ...(emailIds.length ? [`id.in.(${emailIds.join(",")})`] : [])].join(","));
  if (filters.company && uuid.test(filters.company)) {
    const { data: company } = await db.from("company_profiles").select("owner_user_id").eq("id", filters.company).maybeSingle();
    query = company?.owner_user_id ? query.eq("id", company.owner_user_id) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  if (filters.hasDiagnostics === "yes" || filters.hasDiagnostics === "no") {
    const { data: diagnosticUsers } = await db.from("diagnostics").select("created_by_user_id");
    const ids = [...new Set((diagnosticUsers ?? []).map((row) => row.created_by_user_id))];
    if (filters.hasDiagnostics === "yes") query = ids.length ? query.in("id", ids) : query.eq("id", "00000000-0000-0000-0000-000000000000");
    else if (ids.length) query = query.not("id", "in", `(${ids.join(",")})`);
  }
  const { data: users, count, error } = await query.order("full_name").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw new Error("Admin users query failed");
  const rows = users ?? [];
  if (!rows.length) return { rows: [], page, pageSize: PAGE_SIZE, total: count ?? 0, totalPages: 1, filters };
  const [{ data: companies }, { data: diagnostics }] = await Promise.all([
    db.from("company_profiles").select("id,name,owner_user_id").in("owner_user_id", rows.map((row) => row.id)),
    db.from("diagnostics").select("created_by_user_id").in("created_by_user_id", rows.map((row) => row.id)),
  ]);
  const companyMap = new Map((companies ?? []).map((row) => [row.owner_user_id, row.name]));
  const diagnosticCount = countBy(diagnostics ?? [], "created_by_user_id");
  return { rows: rows.map((row) => ({ ...row, email: emailMap.get(row.id) ?? null, companyName: companyMap.get(row.id) ?? "Не указана", diagnosticCount: diagnosticCount.get(row.id) ?? 0 })), page, pageSize: PAGE_SIZE, total: count ?? rows.length, totalPages: Math.max(1, Math.ceil((count ?? rows.length) / PAGE_SIZE)), filters };
}

export async function getAdminUserDetail(userId: string) {
  await requireAdmin();
  if (!uuid.test(userId)) return null;
  const db = createAdminClient();
  const { data: user } = await db.from("users").select("id,full_name,phone,locale,created_at").eq("id", userId).maybeSingle();
  if (!user) return null;
  const [authUsers, { data: company }, { data: diagnostics }] = await Promise.all([loadAuthUsers(), db.from("company_profiles").select("id,name").eq("owner_user_id", userId).maybeSingle(), db.from("diagnostics").select("id,company_id,status,started_at,completed_at").eq("created_by_user_id", userId).order("started_at", { ascending: false })]);
  const ids = (diagnostics ?? []).map((row) => row.id);
  const { data: results } = ids.length ? await db.from("diagnostic_results").select("diagnostic_id,display_manageability_index,maturity_level_id").in("diagnostic_id", ids) : { data: [] };
  const maturityIds = (results ?? []).map((row) => row.maturity_level_id).filter(Boolean);
  const { data: levels } = maturityIds.length ? await db.from("maturity_level_translations").select("maturity_level_id,label").in("maturity_level_id", maturityIds).eq("locale", "ru") : { data: [] };
  const resultMap = new Map((results ?? []).map((row) => [row.diagnostic_id, row])); const levelMap = new Map((levels ?? []).map((row) => [row.maturity_level_id, row.label]));
  return { user: { ...user, email: authUsers.find((item) => item.id === userId)?.email ?? null }, company, diagnostics: (diagnostics ?? []).map((row) => ({ ...row, result: resultMap.get(row.id) ? { ...resultMap.get(row.id), maturityLabel: levelMap.get(resultMap.get(row.id)!.maturity_level_id) ?? null } : null })) };
}

async function loadAuthUsers() { const { data } = await createAdminClient().auth.admin.listUsers({ page: 1, perPage: 1000 }); return data?.users ?? []; }
function countBy(rows: Array<Record<string, unknown>>, key: string) { const map = new Map<string, number>(); for (const row of rows) { const value = row[key]; if (typeof value === "string") map.set(value, (map.get(value) ?? 0) + 1); } return map; }
