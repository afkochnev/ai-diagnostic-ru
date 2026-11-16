/** Generation sequence numbers and prompt revisions are independent. */
export const INDIVIDUAL_PROMPT_VERSIONS = ["RU-1.0", "RU-1.1", "RU-1.2", "RU-1.3", "RU-1.5", "RU-1.6", "RU-1.7", "RU-1.8"] as const;
export type IndividualPromptVersion = typeof INDIVIDUAL_PROMPT_VERSIONS[number];
export const CURRENT_INDIVIDUAL_PROMPT_VERSION: IndividualPromptVersion = "RU-1.7";
export const RU_V3_INDIVIDUAL_PROMPT_VERSION = "RU-1.8";
export const RU_V3_INDIVIDUAL_INPUT_VERSION = "individual-ru-1.6";

export function assertIndividualPromptVersion(value: unknown): asserts value is IndividualPromptVersion {
  if (!INDIVIDUAL_PROMPT_VERSIONS.some(version => version === value)) throw Error("invalid_individual_prompt_version");
}

export function usesRuV3IndividualInput(version: IndividualPromptVersion): boolean {
  return version === "RU-1.6" || version === RU_V3_INDIVIDUAL_PROMPT_VERSION;
}

export function individualPromptForMethodology(definition: string, versionNumber: number): IndividualPromptVersion {
  return definition === "manageability" && versionNumber === 5 ? RU_V3_INDIVIDUAL_PROMPT_VERSION : CURRENT_INDIVIDUAL_PROMPT_VERSION;
}
