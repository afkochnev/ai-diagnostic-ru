import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { authenticatedAccountClient } from "@/server/account/authorization";
import { createAdminClient } from "@/server/supabase/admin";
import { renderTeamPdf, type TeamPdfInput } from "./pdf-render";
import { teamReportV2Schema } from "./report-v2-contracts";
export const teamPdfTemplateVersion="team-report-v1";
const sourceSchema=z.object({report_id:z.uuid(),version:z.number().int().positive(),pipeline:z.enum(["TEAM-RU-2","TEAM-RU-3"]),model:z.string(),completed_at:z.iso.datetime({offset:true}),company_name:z.string(),team_title:z.string(),participant_count:z.number().int().min(3),overall:z.object({mean:z.number(),maturity:z.string()}),blocks:z.array(z.object({title:z.string(),mean:z.number()})).length(8),content:teamReportV2Schema});
const display=(n:number)=>n.toLocaleString("ru-RU",{maximumFractionDigits:1});
async function authorizedSource(reportId:string,userId:string) {
  const client=await authenticatedAccountClient(userId);
  const {data,error}=await (client as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>}).rpc("read_team_pdf_source",{p_report_id:reportId});
  if(error || !data) throw new Error(error?.message==="team_pdf_not_ready"?"team_pdf_not_ready":"team_pdf_access_denied");
  return sourceSchema.parse(data);
}
export function teamPdfFileName(name:string,version:number) {
  const slug=name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50)||"company";
  return `team-management-ai-audit-${slug}-v${version}.pdf`;
}
const db=()=>createAdminClient() as unknown as SupabaseClient;
async function existing(reportId:string,version:number) {
  const {data,error}=await db().from("team_report_artifacts").select("id,status,content_base64,checksum").eq("team_report_id",reportId).eq("team_report_version",version).eq("format","pdf").eq("template_version",teamPdfTemplateVersion).eq("status","ready").maybeSingle();
  if(error) throw new Error("team_pdf_failed");
  return data;
}
export async function getTeamPdf(reportId:string,userId:string) {
  const source=await authorizedSource(reportId,userId),artifact=await existing(reportId,source.version);
  if(!artifact?.content_base64) throw new Error("team_pdf_not_ready");
  const bytes=Buffer.from(artifact.content_base64,"base64");
  if(crypto.createHash("sha256").update(bytes).digest("hex")!==artifact.checksum) throw new Error("team_pdf_failed");
  return {bytes,fileName:teamPdfFileName(source.company_name,source.version)};
}
const locks=new Map<string,Promise<{status:"ready";fileName:string}>>();
async function prepare(reportId:string,userId:string) {
  const source=await authorizedSource(reportId,userId),fileName=teamPdfFileName(source.company_name,source.version);
  if((await existing(reportId,source.version))?.content_base64) return {status:"ready" as const,fileName};
  const input:TeamPdfInput={companyName:source.company_name,teamTitle:source.team_title,completedAt:source.completed_at,participantCount:source.participant_count,index:display(source.overall.mean),maturity:source.overall.maturity,blocks:source.blocks.map(b=>({title:b.title,score:display(b.mean)})),content:source.content,mock:source.model.startsWith("team-mock-")};
  const bytes=await renderTeamPdf(input),checksum=crypto.createHash("sha256").update(bytes).digest("hex");
  await authorizedSource(reportId,userId);
  const {error}=await db().from("team_report_artifacts").upsert({team_report_id:reportId,team_report_version:source.version,format:"pdf",template_version:teamPdfTemplateVersion,status:"ready",storage_path:`team-reports/${reportId}/${teamPdfTemplateVersion}.pdf`,content_base64:bytes.toString("base64"),checksum},{onConflict:"team_report_id,format,template_version",ignoreDuplicates:true});
  if(error || !(await existing(reportId,source.version))?.content_base64) throw new Error("team_pdf_failed");
  return {status:"ready" as const,fileName};
}
export async function prepareTeamPdf(reportId:string,userId:string) {
  await authorizedSource(reportId,userId);
  const key=`${userId}:${reportId}`;
  const current=locks.get(key);if(current)return current;
  const op=prepare(reportId,userId);locks.set(key,op);
  try{return await op;}finally{locks.delete(key);}
}
