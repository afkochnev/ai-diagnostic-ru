type Context = { key_problems: string; main_goals: string };
type Question = { id: string; key: string; answer_type: string };

/** Only the two matching methodology fields can inherit company context. */
export function profileAnswerPrefill(questions: readonly Question[], profile: Context) {
  const context: Record<string, string> = {
    main_management_problem: profile.key_problems,
    main_company_goal: profile.main_goals,
  };
  return questions.flatMap((question) => {
    const value = context[question.key]?.trim();
    return question.answer_type === "text" && value && value.length <= 5000 ? [{ question_id: question.id, text_value: value }] : [];
  });
}

export function openQuestionHint(key: string) {
  if (key === "main_management_problem") return "Достаточно нескольких предложений: что мешает компании, почему это происходит и почему важно сейчас. Если ответ перенесён из профиля, уточните его при необходимости.";
  if (key === "main_company_goal") return "Укажите до трёх главных целей на ближайший год. Если ответ перенесён из профиля, уточните его при необходимости.";
  return null;
}
