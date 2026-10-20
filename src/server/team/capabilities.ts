/** Staging-only foundation. Production enablement is a separate rollout. */
export function teamFoundationEnabled() {
  return process.env.APP_URL === "https://ai-diagnostic-staging-web.onrender.com"
    && process.env.SUPABASE_URL === "https://vflgxgdwlftlyjslyrmo.supabase.co";
}
