import "server-only";

/** Preview is deliberately restricted to staging; billing is a later decision. */
export function canCreateAdditionalCompany(account: { status: string }) {
  return account.status === "active"
    && process.env.APP_URL === "https://ai-diagnostic-staging-web.onrender.com"
    && process.env.SUPABASE_URL === "https://vflgxgdwlftlyjslyrmo.supabase.co";
}
