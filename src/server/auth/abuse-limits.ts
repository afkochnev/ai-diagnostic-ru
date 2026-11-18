import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { enforceRateLimit } from "@/server/rate-limit";
import { authConfig } from "@/server/supabase/config";

type RequestHeaders = Pick<Headers, "get">;

function canonicalIp(value: string | null): string | null {
  const ip = value?.trim();
  if (!ip || ip.includes("%") || !isIP(ip)) return null;
  // Equivalent spellings of an IPv6 address must share a counter.
  return isIP(ip) === 6 ? new URL(`http://[${ip}]`).hostname : ip;
}

function clientIp(headers: RequestHeaders): string {
  // Render's public ingress traverses Cloudflare, which overwrites this header.
  // Do not use CF headers on a deployment without that trusted ingress.
  if (process.env.RENDER === "true") {
    const cloudflareIp = canonicalIp(headers.get("cf-connecting-ip"));
    if (cloudflareIp) return cloudflareIp;
  }
  // A client may prepend arbitrary XFF values. Use the nearest proxy's appended
  // address instead of allowing those prefixes to create unlimited counters.
  // If this is a proxy address, its shared quota errs on the conservative side.
  const forwarded = headers.get("x-forwarded-for")?.split(",").at(-1) ?? null;
  return canonicalIp(forwarded) ?? "unknown";
}

export function isRegistrationHoneypotFilled(value: string): boolean {
  return value.trim().length > 0;
}

/** Call only after checking request origin and validating the registration fields. */
export async function enforceRegistrationLimits(email: string, headers: RequestHeaders): Promise<void> {
  const secret = authConfig().AUTH_FLOW_SECRET;
  const digest = (kind: "ip" | "email", value: string) => createHmac("sha256", secret)
    .update(`auth-registration/${kind}/${value}`).digest("hex");
  const ipKey = digest("ip", clientIp(headers));
  const emailKey = digest("email", email.trim().toLowerCase());

  // Separate names keep the existing fixed-window RPC from sharing windows.
  // Consume sequentially so a rejected short window cannot consume later ones.
  await enforceRateLimit(`auth:register:ip-minute:${ipKey}`, 3, 60);
  await enforceRateLimit(`auth:register:ip-hour:${ipKey}`, 10, 3600);
  await enforceRateLimit(`auth:register:email-minute:${emailKey}`, 1, 60);
  await enforceRateLimit(`auth:register:email-day:${emailKey}`, 5, 86400);
}
