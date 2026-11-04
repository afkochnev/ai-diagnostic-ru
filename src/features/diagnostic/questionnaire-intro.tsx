"use client";
import { pilotText as tr } from "@/i18n/pilot-copy";
import { useLocale } from "@/i18n/context";
export function QuestionnaireIntro() {
  const locale = useLocale();

  return <section aria-labelledby="questionnaire-intro-title" className="mt-6 rounded-2xl border border-line bg-white p-5 sm:p-7">
    <h2 id="questionnaire-intro-title" className="text-xl font-semibold">{tr(locale, "Как пройти диагностику")}</h2>
    <div className="mt-3 space-y-3 text-base leading-relaxed text-muted">
      <p>{tr(locale, "Для ответов на вопросы потребуется около 20 минут. Диагностика поможет увидеть сильные стороны управления и области, где нужны изменения.")}</p>
      <p>{tr(locale, "Проходите блоки по порядку. В вопросах со шкалой выбирайте оценку от 1 до 5, ориентируясь на реальную практику компании.")}</p>
      <p>{tr(locale, "В открытых вопросах опишите ситуацию, возможные причины и желаемый результат. Один-два конкретных примера помогут сделать анализ и рекомендации точнее.")}</p>
      <p>{tr(locale, "Ответы сохраняются автоматически. Можно сделать паузу и продолжить позже.")}</p>
    </div>
  </section>;
}
