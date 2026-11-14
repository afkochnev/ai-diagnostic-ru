import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.generated";
import { openQuestionHint } from "./profile-prefill";

export type QuestionnaireAnswer = {
  question_id: string;
  text_value: string | null;
  numeric_value: number | null;
  revision: number;
};

/** Both entry paths read the same pinned methodology and translation/option semantics. */
export async function loadQuestionnaire(
  client: SupabaseClient<Database>,
  versionId: string,
  answers: QuestionnaireAnswer[],
) {
  const [blockResult, questionResult] = await Promise.all([
    client.from("diagnostic_blocks")
      .select("id,key,position,weight,is_active,diagnostic_block_translations(title)")
      .eq("version_id", versionId)
      .eq("is_active", true)
      .eq("diagnostic_block_translations.locale", "ru")
      .order("position"),
    client.from("questions")
      .select("id,block_id,key,position,answer_type,weight,is_required,is_active,reverse_score,question_translations(prompt,help_text),question_options(id,position,score_value,question_option_translations(label))")
      .eq("version_id", versionId)
      .eq("is_active", true)
      .eq("question_translations.locale", "ru")
      .eq("question_options.question_option_translations.locale", "ru")
      .order("position")
      .order("position", { referencedTable: "question_options" }),
  ]);
  const blocks = blockResult.data;
  const questions = questionResult.data;
  if (blockResult.error || questionResult.error || !blocks?.length || !questions?.length) {
    throw Error("questionnaire_unavailable");
  }

  const answersByQuestion = new Map(answers.map((answer) => [answer.question_id, answer]));
  return blocks.map(({ diagnostic_block_translations: titles, ...block }) => ({
    ...block,
    title: titles[0]?.title ?? block.key,
    questions: questions.filter((question) => question.block_id === block.id).map(({
      question_translations: translations,
      question_options: options,
      ...question
    }) => ({
      ...question,
      prompt: translations[0]?.prompt ?? "",
      help_text: translations[0]?.help_text ?? openQuestionHint(question.key),
      options: options.map(({ question_option_translations: labels, ...option }) => ({
        ...option,
        label: labels[0]?.label ?? String(option.position),
      })),
      answer: answersByQuestion.get(question.id) ?? null,
    })),
  }));
}

export type QuestionnaireBlocks = Awaited<ReturnType<typeof loadQuestionnaire>>;
