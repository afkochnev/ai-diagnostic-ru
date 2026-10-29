/** Generation sequence numbers and prompt revisions are independent. */
export const INDIVIDUAL_PROMPT_VERSIONS = ["RU-1.0", "RU-1.1", "RU-1.2", "RU-1.3", "RU-1.5"] as const;
export type IndividualPromptVersion = typeof INDIVIDUAL_PROMPT_VERSIONS[number];
export const CURRENT_INDIVIDUAL_PROMPT_VERSION: IndividualPromptVersion = "RU-1.5";

export function assertIndividualPromptVersion(value: unknown): asserts value is IndividualPromptVersion {
  if (!INDIVIDUAL_PROMPT_VERSIONS.some(version => version === value)) throw Error("invalid_individual_prompt_version");
}
