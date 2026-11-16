import { isTransientSupabaseError, type SupabaseErrorInfo } from "@/server-runtime/supabase/transient";

export class WorkerQueueClaimError extends Error {
  readonly code: string | undefined;
  readonly retryable: boolean;

  constructor(readonly queue: "scoring" | "ai" | "consultation", readonly status: number | undefined, error: SupabaseErrorInfo) {
    const code = error.code;
    const safeCode = code && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(code) ? code : undefined;
    super(`${queue}_claim_failed:${safeCode ?? status ?? "unknown"}`);
    this.code = safeCode;
    this.retryable = isTransientSupabaseError(status, error);
  }
}
