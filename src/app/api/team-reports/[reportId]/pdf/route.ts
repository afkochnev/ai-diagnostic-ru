import { NextResponse } from "next/server";
import { getIdentity } from "@/server/auth/session";
import { getTeamPdf } from "@/server/team/pdf-service";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_:Request,{params}:{params:Promise<{reportId:string}>}) {
  const identity=await getIdentity();
  if(!identity?.user.email_confirmed_at) return NextResponse.json({error:"access_denied"},{status:401});
  const {reportId}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(reportId))return NextResponse.json({error:"not_found"},{status:404});
  try {
    const pdf=await getTeamPdf(reportId,identity.user.id);
    return new NextResponse(new Uint8Array(pdf.bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${pdf.fileName}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }catch(error){const code=error instanceof Error?error.message:"";const status=code==="team_pdf_not_ready"?409:code==="team_pdf_access_denied"?403:500;return NextResponse.json({error:status===409?"pdf_not_ready":status===403?"access_denied":"pdf_failed"},{status,headers:{"Cache-Control":"no-store"}});}
}
