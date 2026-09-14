import "server-only";
import { createAdminClient } from "@/server-runtime/supabase/admin";

export class RateLimitExceeded extends Error {
  retryAfter: number;
  constructor(retryAfter: number) { super("rate_limited"); this.retryAfter = Math.max(1, Math.ceil(retryAfter)); }
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const { data, error } = await (createAdminClient() as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: { allowed?: boolean; retry_after?: number } | null; error: unknown }> }).rpc("consume_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (error || !data) throw new Error("rate_limit_unavailable");
  if (!data.allowed) throw new RateLimitExceeded(Number(data.retry_after ?? windowSeconds));
}
