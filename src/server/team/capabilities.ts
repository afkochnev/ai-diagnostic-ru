/** Staging rollout; isolated loopback acceptance is explicit and never production. */
export function teamFoundationEnabled() {
  return (process.env.APP_URL === "https://ai-diagnostic-staging-web.onrender.com"
    && process.env.SUPABASE_URL === "https://vflgxgdwlftlyjslyrmo.supabase.co")
    || (process.env.NODE_ENV !== "production" && process.env.TEAM_LOCAL_ACCEPTANCE === "1"
      && /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.APP_URL ?? "")
      && /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SUPABASE_URL ?? ""));
}
