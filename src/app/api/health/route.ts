import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

/** Liveness only: no secrets, dependencies or queue data are exposed. */
export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
