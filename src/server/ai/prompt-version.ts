/** Generation sequence numbers and prompt revisions are independent. */
export const INDIVIDUAL_PROMPT_VERSIONS = ["RU-1.0", "RU-1.1", "RU-1.2", "RU-1.3", "RU-1.5", "EN-1.5"] as const;
export type IndividualPromptVersion = typeof INDIVIDUAL_PROMPT_VERSIONS[number];
export const CURRENT_INDIVIDUAL_PROMPT_VERSION: IndividualPromptVersion = "RU-1.5";

export function assertIndividualPromptVersion(value: unknown): asserts value is IndividualPromptVersion {
  if (!INDIVIDUAL_PROMPT_VERSIONS.some(version => version === value)) throw Error("invalid_individual_prompt_version");
}

export type IndividualReportLocale = "ru" | "en";
export function diagnosticReportLocale(value: unknown): IndividualReportLocale {
  if (value === "en" || value === "ru") return value;
  if (value === undefined || value === null) return "ru";
  throw Error("invalid_individual_report_locale");
}
export function individualPromptVersion(locale: IndividualReportLocale): IndividualPromptVersion {
  return locale === "en" ? "EN-1.5" : CURRENT_INDIVIDUAL_PROMPT_VERSION;
}
/** Saved report language wins over a later page or user preference. */
export function individualReportLocale(promptVersion: unknown, diagnosticLocale?: unknown): IndividualReportLocale {
  if (typeof promptVersion === "string" && promptVersion.startsWith("EN-")) return "en";
  if (typeof promptVersion === "string" && promptVersion.startsWith("RU-")) return "ru";
  return diagnosticReportLocale(diagnosticLocale);
}
