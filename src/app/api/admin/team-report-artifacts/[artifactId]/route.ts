import crypto from "node:crypto";
import {NextResponse} from "next/server";
import {z} from "zod";
import {adminConsoleRead} from "@/server/admin/console";
import {requireAdmin} from "@/server/auth/admin";
export async function GET(_:Request,{params}:{params:Promise<{artifactId:string}>}){
 await requireAdmin();const {artifactId}=await params;
 if(!z.uuid().safeParse(artifactId).success)return NextResponse.json({error:"not_found"},{status:404});
 const parsed=z.object({content_base64:z.string(),checksum:z.string().regex(/^[0-9a-f]{64}$/),version:z.number().int()}).safeParse(await adminConsoleRead("team_pdf",artifactId));
 if(!parsed.success)return NextResponse.json({error:"not_found"},{status:404});
 const bytes=Buffer.from(parsed.data.content_base64,"base64");
 if(crypto.createHash("sha256").update(bytes).digest("hex")!==parsed.data.checksum)return NextResponse.json({error:"pdf_unavailable"},{status:409});
 return new NextResponse(bytes,{headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename="team-report-v${parsed.data.version}.pdf"`,"Cache-Control":"private, no-store"}});
}
