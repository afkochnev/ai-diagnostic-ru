import "server-only";

import { requireAdmin } from "@/server/auth/admin";
import { createAdminClient } from "@/server/supabase/admin";

export const LEAD_PAGE_SIZE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = ["new", "contacted", "consultation_scheduled", "closed"] as const;
const text = (v?: string) => v?.trim().slice(0, 100);
const pageOf = (v?: string) => Math.min(10000, Math.max(1, Number.parseInt(v ?? "1", 10) || 1));
function dateOf(v?: string, end = false) { if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined; const d = new Date(`${v}T${end ? "23:59:59.999" : "00:00:00.000"}Z`); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); }
export type LeadFilters = { q?: string; status?: string; delivery?: string; from?: string; to?: string; company?: string; page?: string };
export type AdminLeadRow = { id:string; name:string; email:string; companyName:string; diagnosticId:string; createdAt:string; status:string; contact:string; hasComment:boolean; deliveryStatus:string|null; provider:string|null; jobStatus:string|null };

export async function getAdminConsultationLeads(filters: LeadFilters = {}) {
  await requireAdmin();
  const db = createAdminClient();
  const page = pageOf(filters.page); const q = text(filters.q); const from = dateOf(filters.from); const to = dateOf(filters.to, true);
  let query = db.from("lead_requests").select("id,user_id,company_id,diagnostic_id,name,email,contact_type,contact_value,comment,status,created_at", { count: "exact" });
  const status = STATUSES.includes(filters.status as (typeof STATUSES)[number]) ? filters.status : undefined;
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("created_at", from); if (to) query = query.lte("created_at", to);
  if (filters.company && UUID.test(filters.company)) query = query.eq("company_id", filters.company);
  if (filters.delivery && ["queued", "sending", "sent", "failed"].includes(filters.delivery)) {
    const { data: ds } = await db.from("consultation_notification_deliveries").select("lead_request_id").eq("status", filters.delivery);
    const ids = (ds ?? []).map((x) => x.lead_request_id); query = ids.length ? query.in("id", ids) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  if (q) {
    const [{ data: companies }] = await Promise.all([db.from("company_profiles").select("id").ilike("name", `%${q}%`).limit(500)]);
    const companyIds = (companies ?? []).map((x) => x.id);
    const or = [`name.ilike.%${q}%`, `email.ilike.%${q}%`]; if (companyIds.length) or.push(`company_id.in.(${companyIds.join(",")})`); query = query.or(or.join(","));
  }
  const { data: leads, count, error } = await query.order("created_at", { ascending: false }).range((page - 1) * LEAD_PAGE_SIZE, page * LEAD_PAGE_SIZE - 1);
  if (error) throw new Error("Admin consultation leads query failed");
  const rows = leads ?? []; if (!rows.length) return { rows: [], page, pageSize: LEAD_PAGE_SIZE, total: count ?? 0, totalPages: 1, filters };
  const ids = rows.map((x) => x.id); const companyIds = [...new Set(rows.map((x) => x.company_id))];
  const [{ data: companies }, { data: deliveries }] = await Promise.all([
    db.from("company_profiles").select("id,name").in("id", companyIds),
    db.from("consultation_notification_deliveries").select("lead_request_id,status,provider,job_id").in("lead_request_id", ids),
  ]);
  const jobIds = (deliveries ?? []).map((x) => x.job_id); const { data: jobs } = jobIds.length ? await db.from("jobs").select("id,status").in("id", jobIds) : { data: [] as { id:string; status:string }[] };
  const companyMap = new Map((companies ?? []).map((x) => [x.id, x.name])); const deliveryMap = new Map((deliveries ?? []).map((x) => [x.lead_request_id, x])); const jobMap = new Map((jobs ?? []).map((x) => [x.id, x.status]));
  return { rows: rows.map((x) => { const d = deliveryMap.get(x.id); return { id:x.id,name:x.name,email:x.email,companyName:companyMap.get(x.company_id) ?? "Не указана",diagnosticId:x.diagnostic_id,createdAt:x.created_at,status:x.status,contact:x.contact_type && x.contact_value ? `${x.contact_type}: ${x.contact_value}` : "Не указан",hasComment:Boolean(x.comment?.trim()),deliveryStatus:d?.status ?? null,provider:d?.provider ?? null,jobStatus:d ? jobMap.get(d.job_id) ?? null : null }; }), page, pageSize: LEAD_PAGE_SIZE, total: count ?? rows.length, totalPages: Math.max(1, Math.ceil((count ?? rows.length) / LEAD_PAGE_SIZE)), filters };
}

export async function getAdminConsultationLeadDetail(leadId: string) {
  await requireAdmin(); if (!UUID.test(leadId)) return null; const db = createAdminClient();
  const { data: lead } = await db.from("lead_requests").select("id,user_id,company_id,diagnostic_id,name,email,contact_type,contact_value,comment,status,created_at,updated_at").eq("id", leadId).maybeSingle(); if (!lead) return null;
  const [{ data: company }, { data: user }, { data: diagnostic }, { data: delivery }] = await Promise.all([
    db.from("company_profiles").select("id,name").eq("id", lead.company_id).maybeSingle(),
    db.from("users").select("id,full_name,phone").eq("id", lead.user_id).maybeSingle(),
    db.from("diagnostics").select("id,status,started_at,completed_at").eq("id", lead.diagnostic_id).maybeSingle(),
    db.from("consultation_notification_deliveries").select("id,status,provider,provider_message_id,sent_at,attempt_count,last_error_code,last_error_message,job_id").eq("lead_request_id", leadId).maybeSingle(),
  ]);
  const { data: job } = delivery?.job_id ? await db.from("jobs").select("id,status,attempts,started_at,completed_at").eq("id", delivery.job_id).maybeSingle() : { data: null };
  return { lead, company, user, diagnostic, delivery, job };
}
