import { NextResponse } from "next/server";
import { authCaptchaConfig } from "@/server-runtime/auth-captcha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only the public site key is returned; no provider or application secrets. */
export function GET() {
  const config = authCaptchaConfig();
  return NextResponse.json(config, {
    status: config.configured ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0", "CDN-Cache-Control": "no-store" },
  });
}
