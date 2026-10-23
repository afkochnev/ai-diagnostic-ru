/** Ordinary owner requests must never silently become demonstrations. */
export function ordinaryTeamReportProvider(env: Record<string, string | undefined> = process.env): "openai" {
  // This is a producer check. Only the worker consumes AI credentials and checks
  // them immediately before generation; web must not require a copied AI secret.
  if (env.TEAM_AI_PROVIDER !== "openai") throw new Error("team_real_provider_unavailable");
  return "openai";
}
