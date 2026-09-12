import { NextResponse } from "next/server";
import { runPendingConsultationNotifications } from "@/server/consultation/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const secret = process.env.INTERNAL_WORKER_SECRET;
  if (!secret || request.headers.get("x-worker-secret") !== secret) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try { return NextResponse.json(await runPendingConsultationNotifications(10), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const safe = error instanceof Error ? error as Error & { code?: string; details?: string; hint?: string } : undefined;
    console.error("[consultation-worker]", {
      checkpoint: "route_error",
      name: safe?.name ?? "UnknownError",
      message: safe?.message ?? "unknown",
      code: safe?.code,
      details: safe?.details,
      hint: safe?.hint,
      ...(process.env.NODE_ENV !== "production" && safe?.stack ? { stack: safe.stack } : {}),
    });
    return NextResponse.json({ error: "worker_failed" }, { status: 500 });
  }
}
