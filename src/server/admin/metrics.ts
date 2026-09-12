import "server-only";
import { requireAdmin } from "@/server/auth/admin";
import { createAdminClient } from "@/server/supabase/admin";
/* Query builders are intentionally kept local to this server-only aggregate adapter. */
/* eslint-disable @typescript-eslint/no-explicit-any */

function boundary(value?: string, end = false) { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined; const d = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); }
export type MetricsFilters = { from?: string; to?: string };
export async function getAdminMetrics(filters: MetricsFilters = {}) {
  await requireAdmin(); const db = createAdminClient(); const from = boundary(filters.from); const to = boundary(filters.to, true);
  const scoped = <T extends { gte: (c:string,v:string)=>T; lte:(c:string,v:string)=>T }>(query:T, field:string) => { let q=query; if(from) q=q.gte(field,from); if(to) q=q.lte(field,to); return q; };
  const auth = await db.auth.admin.listUsers({ page:1, perPage:1000 }); const authUsers = auth.data?.users ?? []; const registered = authUsers.filter((u)=> (!from || u.created_at >= from) && (!to || u.created_at <= to)); const confirmed = authUsers.filter((u)=> !!u.email_confirmed_at && (!from || u.email_confirmed_at! >= from) && (!to || u.email_confirmed_at! <= to));
  const [{ count: companies }, { count: started }, { count: completed }, { data: reportRows }, { count: versions }, { count: pdf }, { count: emailRequests }, { count: emailSent }, { count: leads }, { count: feedback }, { data: feedbackRows }] = await Promise.all([
    scoped(db.from("company_profiles").select("id",{count:"exact",head:true}),"created_at"), scoped(db.from("diagnostics").select("id",{count:"exact",head:true}),"started_at"), scoped(db.from("diagnostics").select("id",{count:"exact",head:true}).eq("status","completed"),"completed_at"), scoped(db.from("ai_reports").select("diagnostic_id").eq("status","completed"),"created_at"), scoped(db.from("ai_reports").select("id",{count:"exact",head:true}),"created_at"), scoped(db.from("report_artifacts").select("id",{count:"exact",head:true}).eq("status","ready"),"generated_at"), scoped(db.from("email_deliveries").select("id",{count:"exact",head:true}),"created_at"), scoped(db.from("email_deliveries").select("id",{count:"exact",head:true}).eq("status","sent"),"sent_at"), scoped(db.from("lead_requests").select("id",{count:"exact",head:true}),"created_at"), scoped(db.from("feedback").select("id",{count:"exact",head:true}),"created_at"), scoped(db.from("feedback").select("rating"),"created_at")
  ]);
  const ratings = feedbackRows ?? []; const average = ratings.length ? ratings.reduce((sum,row)=>sum+row.rating,0)/ratings.length : null;
  const { data: cohortRows } = await scoped(db.from("diagnostics").select("id"),"started_at"); const cohortIds=(cohortRows??[]).map((x)=>x.id);
  const cohort = async (table:"diagnostics"|"ai_reports"|"lead_requests"|"feedback", column:"id"|"diagnostic_id", extra?: (q:any)=>any) => { if(!cohortIds.length) return 0; let q:any=db.from(table).select(column); if(extra) q=extra(q); const { data }=await q.in(table==="diagnostics"?"id":"diagnostic_id",cohortIds); return new Set((data??[]).map((x:any)=>x[column])).size; };
  const [cohortCompleted, cohortReports, cohortLeads, cohortFeedback] = await Promise.all([cohort("diagnostics","id",(q:any)=>q.eq("status","completed").not("completed_at","is",null)),cohort("ai_reports","diagnostic_id",(q:any)=>q.eq("status","completed")),cohort("lead_requests","diagnostic_id"),cohort("feedback","diagnostic_id")]);
  return { period:{from:filters.from??null,to:filters.to??null,fromUtc:from??null,toUtc:to??null}, kpi:{registered:registered.length,confirmed:confirmed.length,companies:companies??0,started:started??0,completed:completed??0,reports:new Set((reportRows??[]).map((x)=>x.diagnostic_id)).size,reportVersions:versions??0,pdf:pdf??0,emailRequests:emailRequests??0,emailSent:emailSent??0,leads:leads??0,feedback:feedback??0,average}, funnel:{started:cohortIds.length,completed:cohortCompleted,reports:cohortReports,leads:cohortLeads,feedback:cohortFeedback} };
}
