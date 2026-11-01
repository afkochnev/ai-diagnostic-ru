import "server-only";
import {z} from "zod";
import {requireAdmin} from "@/server/auth/admin";
import {createAuthClient} from "@/server/supabase/server";
import type {Json} from "@/types/database.generated";

export const adminSections=["accounts","users","companies","diagnostics","leads","feedback"] as const;
export type AdminSection=typeof adminSections[number];
export const adminFiltersSchema=z.object({q:z.string().trim().max(100).optional(),page:z.coerce.number().int().min(1).max(10000).default(1),plan:z.enum(["","free","advanced"]).optional(),status:z.string().max(30).optional(),delivery:z.enum(["","queued","sending","sent","failed"]).optional(),rating:z.enum(["","1","2","3","4","5"]).optional(),type:z.enum(["","individual","team"]).optional(),account:z.union([z.uuid(),z.literal("")]).optional(),company:z.union([z.uuid(),z.literal("")]).optional(),user:z.union([z.uuid(),z.literal("")]).optional(),from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional()});
export type AdminFilters=z.infer<typeof adminFiltersSchema>;
const rowSchema=z.object({id:z.uuid(),name:z.string().optional(),phone:z.string().nullable().optional(),locale:z.string().optional(),title:z.string().optional(),status:z.string().optional(),type:z.string().optional(),created_at:z.string(),completed_at:z.string().nullable().optional(),email:z.string().nullable().optional(),owner_name:z.string().nullable().optional(),owner_email:z.string().nullable().optional(),account_id:z.uuid().optional(),account_name:z.string().optional(),company_id:z.uuid().optional(),company_name:z.string().optional(),plan:z.enum(["free","advanced"]).optional(),global_role:z.string().optional(),user_id:z.uuid().optional(),diagnostic_id:z.uuid().nullable().optional(),diagnostic_type:z.enum(["individual","team"]).optional(),team_diagnostic_id:z.uuid().nullable().optional(),team_report_id:z.uuid().nullable().optional(),email_confirmed_at:z.string().nullable().optional(),companies:z.number().optional(),accounts:z.number().optional(),individual_diagnostics:z.number().optional(),team_diagnostics:z.number().optional(),team_participations:z.number().optional(),employee_count:z.number().optional(),invited:z.number().optional(),started:z.number().optional(),completed:z.number().optional(),revoked:z.number().optional(),aggregate_status:z.string().optional(),report_status:z.string().optional(),report_version:z.number().nullable().optional(),pdf_ready:z.boolean().optional(),index:z.number().nullable().optional(),maturity:z.string().nullable().optional(),notification_status:z.string().optional(),rating:z.number().optional(),contact_type:z.string().nullable().optional(),contact_value:z.string().nullable().optional(),comment:z.string().nullable().optional(),useful:z.string().nullable().optional(),improve:z.string().nullable().optional()});
export type AdminRow=z.infer<typeof rowSchema>;
const listSchema=z.object({rows:z.array(rowSchema).max(25),total:z.number().nonnegative(),page:z.number().int(),page_size:z.literal(25),summary:z.object({average:z.number().nullable()}).optional()});
const metricSchema=z.record(z.string(),z.union([z.number(),z.null(),z.record(z.string(),z.number())]));
export type AdminMetrics=z.infer<typeof metricSchema>;
export async function adminConsoleRead(section:string,id:string|null=null,filters:Record<string,unknown>={}){
 await requireAdmin();
 const client=await createAuthClient();
 const {data,error}=await client.rpc("read_admin_console",{p_section:section,p_id:id,p_filters:filters as Json});
 if(error)throw new Error("admin_data_unavailable");
 return data as unknown;
}
export async function adminList(section:AdminSection,raw:Record<string,unknown>={}){
 const parsed=adminFiltersSchema.safeParse(raw);if(!parsed.success)throw new Error("admin_invalid_filter");
 const result=listSchema.parse(await adminConsoleRead(section,null,parsed.data));
 return {...result,totalPages:Math.max(1,Math.ceil(result.total/25)),filters:parsed.data};
}
export async function adminDetail(section:AdminSection,id:string){
 if(!z.uuid().safeParse(id).success){await requireAdmin();return null;}
 const data=await adminConsoleRead(section,id);if(data===null)return null;
 const detail=z.object({item:rowSchema,memberships:z.array(z.record(z.string(),z.unknown())).max(25).optional(),plan_history:z.array(z.record(z.string(),z.unknown())).max(25).optional(),report_counts:z.record(z.string(),z.number()).optional(),pdf_counts:z.record(z.string(),z.number()).optional(),profile:z.record(z.string(),z.unknown()).optional(),participation_statuses:z.array(z.object({status:z.string(),count:z.number()})).optional()}).parse(data);
 return detail;
}
export async function adminMetrics(raw:Record<string,unknown>={}){
 const parsed=adminFiltersSchema.safeParse(raw);if(!parsed.success)throw new Error("admin_invalid_filter");
 return metricSchema.parse(await adminConsoleRead("metrics",null,parsed.data));
}
export const adminTeamSchema=z.object({item:rowSchema,result:z.object({overall:z.object({overall_mean:z.number(),overall_stddev:z.number(),completed_participant_count:z.number()}),blocks:z.array(z.object({title:z.string(),mean_score:z.number(),stddev_score:z.number()}))}).nullable(),report:z.object({id:z.uuid(),version:z.number(),pipeline:z.string(),model:z.string().nullable(),content:z.unknown()}).nullable(),pdfs:z.array(z.object({id:z.uuid(),team_report_id:z.uuid(),template_version:z.string(),generated_at:z.string(),checksum:z.string()})).max(25)});
export async function adminTeam(id:string){
 if(!z.uuid().safeParse(id).success){await requireAdmin();return null;}
 const data=await adminConsoleRead("team",id);return data===null?null:adminTeamSchema.parse(data);
}
export const systemSchema=z.object({public_jobs:z.array(z.object({kind:z.string(),status:z.string(),count:z.number()})),team_jobs:z.array(z.object({kind:z.string(),status:z.string(),count:z.number()})),active_leases:z.number(),email_failures:z.number(),invitation_failures:z.null(),consultation_failures:z.number(),last_worker_activity:z.string().nullable(),recent_failures:z.array(z.object({id:z.uuid(),kind:z.string(),status:z.string(),created_at:z.string(),error_code:z.string()})).max(25),page:z.number()});
export async function adminSystem(page=1){return systemSchema.parse(await adminConsoleRead("system",null,{page}));}
