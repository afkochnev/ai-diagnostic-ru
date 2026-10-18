import "server-only";

/** Technical rollout only; Account entitlement is checked separately by callers. */
export function canCreateAdditionalCompany(account: { status: string }) {
  return account.status === "active"
    && process.env.APP_URL === "https://ai-diagnostic-staging-web.onrender.com"
    && process.env.SUPABASE_URL === "https://vflgxgdwlftlyjslyrmo.supabase.co";
}
