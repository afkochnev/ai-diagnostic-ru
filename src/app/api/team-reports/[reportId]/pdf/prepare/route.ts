import { NextResponse } from "next/server";
import { getIdentity } from "@/server/auth/session";
import { prepareTeamPdf } from "@/server/team/pdf-service";
import { enforceRateLimit, RateLimitExceeded } from "@/server/rate-limit";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{reportId:string}>}) {
  if(request.headers.get("origin") && request.headers.get("origin")!==new URL(request.url).origin) return NextResponse.json({error:"access_denied"},{status:403});
  const identity=await getIdentity();
  if(!identity?.user.email_confirmed_at)return NextResponse.json({error:"access_denied"},{status:401});
  const {reportId}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(reportId))return NextResponse.json({error:"not_found"},{status:404});
  try {
    await enforceRateLimit(`team-pdf-prepare:${identity.user.id}`,5,3600);
    return NextResponse.json(await prepareTeamPdf(reportId,identity.user.id),{headers:{"Cache-Control":"no-store"}});
  }catch(error){if(error instanceof RateLimitExceeded)return NextResponse.json({error:"rate_limited"},{status:429});const code=error instanceof Error?error.message:"";const status=code==="team_pdf_not_ready"?409:code==="team_pdf_access_denied"?403:500;return NextResponse.json({error:status===409?"pdf_not_ready":status===403?"access_denied":"pdf_prepare_failed"},{status});}
}
