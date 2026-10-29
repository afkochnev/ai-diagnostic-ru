import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth/admin";
import { getAdminPdfStatus } from "@/server/pdf/service";
import { adminPdfFailure, adminPdfHeaders, pdfReportIdValid } from "@/server/pdf/admin-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ reportId: string }> }) {
  await requireAdmin();
  const { reportId } = await params;
  if (!pdfReportIdValid(reportId)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: adminPdfHeaders });
  try { return NextResponse.json(await getAdminPdfStatus(reportId), { headers: adminPdfHeaders }); }
  catch (error) { return adminPdfFailure(error); }
}
