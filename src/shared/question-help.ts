/** Hide obsolete profile advice in current questions and saved Team snapshots. */
export function questionHelpForDisplay(help: string | null | undefined, answerType: string) {
  if (answerType !== "text") return help;
  return help
    ?.replace(/^Достаточно нескольких предложений(?:[^.!?]*[.!?]|$)\s*/iu, "")
    .replace(/Если ответ перенес[её]н из профиля, уточните его при необходимости\.?/giu, "")
    .trim();
}
