/** Ordinary owner requests must never silently become demonstrations. */
export function ordinaryTeamReportProvider(env: Record<string, string | undefined> = process.env): "openai" {
  if (env.TEAM_AI_PROVIDER !== "openai" || !env.OPENAI_API_KEY?.trim()) throw new Error("team_real_provider_unavailable");
  return "openai";
}
