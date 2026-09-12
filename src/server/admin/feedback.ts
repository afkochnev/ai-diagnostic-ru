import "server-only";
import { requireAdmin } from "@/server/auth/admin";
import { createAdminClient } from "@/server/supabase/admin";

export const FEEDBACK_PAGE_SIZE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (v?: string) => v?.trim().slice(0, 100);
const pageOf = (v?: string) => Math.min(10000, Math.max(1, Number.parseInt(v ?? "1", 10) || 1));
function dateOf(v?: string, end = false) { if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined; const d = new Date(`${v}T${end ? "23:59:59.999" : "00:00:00.000"}Z`); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); }
export type FeedbackFilters = { q?: string; rating?: string; from?: string; to?: string; company?: string; useful?: string; improve?: string; page?: string };
export type AdminFeedbackRow = { id:string; rating:number; createdAt:string; userName:string; email:string|null; companyName:string; diagnosticId:string; hasUseful:boolean; hasImprove:boolean };

export async function getAdminFeedback(filters: FeedbackFilters = {}) {
  await requireAdmin(); const db = createAdminClient(); const page = pageOf(filters.page); const q = text(filters.q); const from = dateOf(filters.from); const to = dateOf(filters.to, true);
  let query = db.from("feedback").select("id,user_id,company_id,diagnostic_id,rating,useful,improve,created_at", { count: "exact" });
  const rating = Number.parseInt(filters.rating ?? "", 10); if (rating >= 1 && rating <= 5) query = query.eq("rating", rating);
  if (from) query = query.gte("created_at", from); if (to) query = query.lte("created_at", to); if (filters.company && UUID.test(filters.company)) query = query.eq("company_id", filters.company);
  if (filters.useful === "yes" || filters.useful === "no") query = filters.useful === "yes" ? query.not("useful", "is", null) : query.is("useful", null);
  if (filters.improve === "yes" || filters.improve === "no") query = filters.improve === "yes" ? query.not("improve", "is", null) : query.is("improve", null);
  const authUsers = await loadAuthUsers(); const emailIds = q ? authUsers.filter((u) => u.email?.toLowerCase().includes(q.toLowerCase())).map((u) => u.id) : [];
  if (q) { const [{ data: users }, { data: companies }] = await Promise.all([db.from("users").select("id").ilike("full_name", `%${q}%`).limit(500), db.from("company_profiles").select("id").ilike("name", `%${q}%`).limit(500)]); const ids = [...new Set([...(users ?? []).map((x) => x.id), ...emailIds])]; const companyIds = (companies ?? []).map((x) => x.id); const ors = []; if (ids.length) ors.push(`user_id.in.(${ids.join(",")})`); if (companyIds.length) ors.push(`company_id.in.(${companyIds.join(",")})`); if (!ors.length) return empty(page); query = query.or(ors.join(",")); }
  const { data: feedback, count, error } = await query.order("created_at", { ascending: false }).range((page - 1) * FEEDBACK_PAGE_SIZE, page * FEEDBACK_PAGE_SIZE - 1); if (error) throw new Error("Admin feedback query failed"); const rows = feedback ?? []; if (!rows.length) return { rows:[], page, pageSize:FEEDBACK_PAGE_SIZE, total:count ?? 0, totalPages:1, filters, average:null };
  const userIds = [...new Set(rows.map((x) => x.user_id))]; const companyIds = [...new Set(rows.map((x) => x.company_id))];
  const [{ data: users }, { data: companies }] = await Promise.all([db.from("users").select("id,full_name").in("id", userIds), db.from("company_profiles").select("id,name").in("id", companyIds)]);
  const userMap = new Map((users ?? []).map((x) => [x.id, x.full_name])); const companyMap = new Map((companies ?? []).map((x) => [x.id, x.name])); const emailMap = new Map(authUsers.map((x) => [x.id, x.email ?? null]));
  const { data: allRatings } = await db.from("feedback").select("rating"); const average = allRatings?.length ? allRatings.reduce((sum, x) => sum + x.rating, 0) / allRatings.length : null;
  return { rows:rows.map((x) => ({ id:x.id,rating:x.rating,createdAt:x.created_at,userName:userMap.get(x.user_id) ?? "Не указан",email:emailMap.get(x.user_id) ?? null,companyName:companyMap.get(x.company_id) ?? "Не указана",diagnosticId:x.diagnostic_id,hasUseful:Boolean(x.useful?.trim()),hasImprove:Boolean(x.improve?.trim()) })), page,pageSize:FEEDBACK_PAGE_SIZE,total:count ?? rows.length,totalPages:Math.max(1,Math.ceil((count ?? rows.length)/FEEDBACK_PAGE_SIZE)),filters,average };
}
export async function getAdminFeedbackDetail(feedbackId: string) { await requireAdmin(); if (!UUID.test(feedbackId)) return null; const db = createAdminClient(); const { data: feedback } = await db.from("feedback").select("id,user_id,company_id,diagnostic_id,rating,useful,improve,created_at,updated_at").eq("id", feedbackId).maybeSingle(); if (!feedback) return null; const [{ data: user }, { data: company }, { data: diagnostic }, authUsers] = await Promise.all([db.from("users").select("id,full_name").eq("id", feedback.user_id).maybeSingle(),db.from("company_profiles").select("id,name").eq("id", feedback.company_id).maybeSingle(),db.from("diagnostics").select("id,status,started_at,completed_at").eq("id", feedback.diagnostic_id).maybeSingle(),loadAuthUsers()]); const { data: result } = await db.from("diagnostic_results").select("display_manageability_index,maturity_level_id").eq("diagnostic_id", feedback.diagnostic_id).maybeSingle(); let maturity = null; if (result?.maturity_level_id) { const { data } = await db.from("maturity_level_translations").select("label").eq("maturity_level_id", result.maturity_level_id).eq("locale", "ru").maybeSingle(); maturity = data?.label ?? null; } return { feedback, user, email:authUsers.find((x) => x.id === feedback.user_id)?.email ?? null, company, diagnostic, result, maturity }; }
async function loadAuthUsers() { const { data } = await createAdminClient().auth.admin.listUsers({ page:1, perPage:1000 }); return data?.users ?? []; }
function empty(page:number) { return { rows:[],page,pageSize:FEEDBACK_PAGE_SIZE,total:0,totalPages:1,filters:{},average:null }; }
