import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { authConfig } from "@/server/supabase/config";

const name = "auth-recovery";
function signature(payload: string) { return createHmac("sha256", authConfig().AUTH_FLOW_SECRET).update(payload).digest("hex"); }

export async function setRecovery(userId: string, sessionId: string) {
  const payload = Buffer.from(JSON.stringify({ userId, sessionId, expires: Date.now() + 3600000 })).toString("base64url");
  (await cookies()).set(name, `${payload}.${signature(payload)}`, { httpOnly: true, secure: authConfig().secure, sameSite: "lax", path: "/", maxAge: 3600 });
}

export async function hasRecovery(userId: string, sessionId: string) {
  const value = (await cookies()).get(name)?.value;
  if (!value) return false;
  const [payload, mac] = value.split(".");
  if (!payload || !mac || !/^[a-f0-9]{64}$/.test(mac)) return false;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(signature(payload)))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { userId: string; sessionId: string; expires: number };
    return data.userId === userId && data.sessionId === sessionId && data.expires > Date.now();
  } catch { return false; }
}

export async function clearRecovery() { (await cookies()).delete(name); }
