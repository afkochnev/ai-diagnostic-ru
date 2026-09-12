import "server-only";

import { requireAdmin } from "@/server/auth/admin";
import { createAdminClient } from "@/server/supabase/admin";

const PAGE_SIZE = 20;
const statuses = ["in_progress", "submitted", "scoring", "scoring_failed", "completed"] as const;
type Filter = { q?: string; status?: string; from?: string; to?: string; report?: string; feedback?: string; consultation?: string; page?: string };

function validDate(value: string | undefined, end = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parsePage(value: string | undefined) {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

export type AdminDiagnosticRow = {
  id: string;
  companyName: string;
  userName: string;
  createdAt: string;
  completedAt: string | null;
  status: string;
  index: number | null;
  maturity: string | null;
  hasReport: boolean;
  reportStatuses: string[];
  reportVersions: number[];
  feedbackRating: number | null;
  consultationStatuses: string[];
};

export async function getAdminDiagnostics(filters: Filter = {}) {
  await requireAdmin();
  const db = createAdminClient();
  const page = parsePage(filters.page);
  const q = filters.q?.trim().slice(0, 100);
  const status = statuses.includes(filters.status as (typeof statuses)[number]) ? filters.status : undefined;
  const from = validDate(filters.from);
  const to = validDate(filters.to, true);

  let scopedIds: string[] | undefined;
  if (q) {
    const [{ data: companies }, { data: users }] = await Promise.all([
      db.from("company_profiles").select("id").ilike("name", `%${q}%`).limit(500),
      db.from("users").select("id").ilike("full_name", `%${q}%`).limit(500),
    ]);
    const companyIds = (companies ?? []).map((row) => row.id);
    const userIds = (users ?? []).map((row) => row.id);
    if (companyIds.length === 0 && userIds.length === 0) return emptyResult(page);
    const [{ data: byCompany }, { data: byUser }] = await Promise.all([
      companyIds.length ? db.from("diagnostics").select("id").in("company_id", companyIds) : Promise.resolve({ data: [] as { id: string }[] }),
      userIds.length ? db.from("diagnostics").select("id").in("created_by_user_id", userIds) : Promise.resolve({ data: [] as { id: string }[] }),
    ]);
    scopedIds = [...new Set([...(byCompany ?? []), ...(byUser ?? [])].map((row) => row.id))];
    if (scopedIds.length === 0) return emptyResult(page);
  }

  const relationIds = async (table: "ai_reports" | "feedback" | "lead_requests") => {
    const { data } = await db.from(table).select("diagnostic_id");
    return new Set((data ?? []).map((row) => row.diagnostic_id));
  };
  const [reportIds, feedbackIds, consultationIds] = await Promise.all([
    filters.report ? relationIds("ai_reports") : Promise.resolve(undefined),
    filters.feedback ? relationIds("feedback") : Promise.resolve(undefined),
    filters.consultation ? relationIds("lead_requests") : Promise.resolve(undefined),
  ]);
  // Presence sets are narrowed below using relation IDs; this keeps filters
  // server-side and avoids loading relation rows into the browser.
  let presenceIds: string[] | undefined;
  const absentIds: string[] = [];
  for (const [set, value] of [[reportIds, filters.report], [feedbackIds, filters.feedback], [consultationIds, filters.consultation]] as const) {
    if (!set || !value) continue;
    if (value === "yes") {
      const ids = [...set];
      presenceIds = presenceIds ? presenceIds.filter((id) => ids.includes(id)) : ids;
    } else if (value === "no") absentIds.push(...set);
  }
  if (presenceIds?.length === 0) return emptyResult(page);

  let query = db.from("diagnostics").select("id,company_id,created_by_user_id,started_at,completed_at,status", { count: "exact" });
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("started_at", from);
  if (to) query = query.lte("started_at", to);
  if (scopedIds) query = query.in("id", scopedIds);
  if (presenceIds) query = query.in("id", presenceIds);
  if (absentIds.length) query = query.not("id", "in", `(${[...new Set(absentIds)].join(",")})`);
  const { data: diagnostics, count, error } = await query.order("started_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw new Error("Admin diagnostics query failed");
  const rows = diagnostics ?? [];
  if (rows.length === 0) return emptyResult(page, count ?? 0);
  const ids = rows.map((row) => row.id);
  const companyIds = [...new Set(rows.map((row) => row.company_id))];
  const userIds = [...new Set(rows.map((row) => row.created_by_user_id))];
  const [{ data: companies }, { data: users }, { data: results }, { data: reports }, { data: feedback }, { data: leads }] = await Promise.all([
    db.from("company_profiles").select("id,name").in("id", companyIds),
    db.from("users").select("id,full_name").in("id", userIds),
    db.from("diagnostic_results").select("diagnostic_id,display_manageability_index,maturity_level_id").in("diagnostic_id", ids),
    db.from("ai_reports").select("diagnostic_id,status,version").in("diagnostic_id", ids),
    db.from("feedback").select("diagnostic_id,rating").in("diagnostic_id", ids),
    db.from("lead_requests").select("diagnostic_id,status").in("diagnostic_id", ids),
  ]);
  const maturityIds = [...new Set((results ?? []).map((row) => row.maturity_level_id).filter(Boolean))] as string[];
  const { data: maturity } = maturityIds.length ? await db.from("maturity_level_translations").select("maturity_level_id,label").in("maturity_level_id", maturityIds).eq("locale", "ru") : { data: [] as { maturity_level_id: string; label: string }[] };
  const companyMap = new Map((companies ?? []).map((row) => [row.id, row.name]));
  const userMap = new Map((users ?? []).map((row) => [row.id, row.full_name]));
  const resultMap = new Map((results ?? []).map((row) => [row.diagnostic_id, row]));
  const maturityMap = new Map((maturity ?? []).map((row) => [row.maturity_level_id, row.label]));
  const reportMap = groupBy(reports ?? [], "diagnostic_id");
  const feedbackMap = new Map((feedback ?? []).map((row) => [row.diagnostic_id, row.rating]));
  const leadMap = groupBy(leads ?? [], "diagnostic_id");
  const mapped = rows.map((row) => {
    const result = resultMap.get(row.id);
    const diagnosticReports = reportMap.get(row.id) ?? [];
    return {
      id: row.id, companyName: companyMap.get(row.company_id) ?? "—", userName: userMap.get(row.created_by_user_id) ?? "—",
      createdAt: row.started_at, completedAt: row.completed_at, status: row.status,
      index: result?.display_manageability_index ?? null, maturity: result?.maturity_level_id ? maturityMap.get(result.maturity_level_id) ?? null : null,
      hasReport: diagnosticReports.some((report) => report.status === "completed"),
      reportStatuses: [...new Set(diagnosticReports.map((report) => report.status))], reportVersions: diagnosticReports.map((report) => report.version).sort((a, b) => a - b),
      feedbackRating: feedbackMap.get(row.id) ?? null, consultationStatuses: [...new Set((leadMap.get(row.id) ?? []).map((lead) => lead.status))],
    } satisfies AdminDiagnosticRow;
  });
  return { rows: mapped, page, pageSize: PAGE_SIZE, total: count ?? mapped.length, totalPages: Math.max(1, Math.ceil((count ?? mapped.length) / PAGE_SIZE)), filters };
}

function groupBy<T extends Record<string, unknown>>(items: T[], key: keyof T) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const value = item[key];
    if (typeof value !== "string") continue;
    map.set(value, [...(map.get(value) ?? []), item]);
  }
  return map;
}

function emptyResult(page: number, total = 0) {
  return { rows: [] as AdminDiagnosticRow[], page, pageSize: PAGE_SIZE, total, totalPages: 1, filters: {} };
}
