import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it, vi} from "vitest";
vi.mock("@/features/team/participant-result-pdf-button", () => ({ParticipantResultPdfButton: () => null}));
import {ParticipantResultView} from "@/features/team/participant-result";
import type {ParticipantResult} from "@/server/team/participant-result-contracts";

const result: ParticipantResult = {
  participant_id: "self", display_name: "Участник", team_title: "Диагностика команды", status: "completed", completed_at: "2026-11-01T10:00:00Z",
  overall_raw: 65, overall_display: 65, maturity_label: "Зона развития", blocks: [],
  open_answers: [
    {question_id: "own-1", position: 1, block_title: "Общая информация", prompt: "Какую проблему нужно решить?", answer: "Согласовать роли.\nНаш план <script>не HTML</script>"},
    {question_id: "own-2", position: 83, block_title: "Открытые вопросы", prompt: "Что можно улучшить?", answer: null},
  ],
};
describe("own participant result", () => {
  it("shows saved open answers as multiline escaped text, including blank optional answers", () => {
    const html = renderToStaticMarkup(createElement(ParticipantResultView, {result}));
    expect(html).toContain("Это ваша оценка системы управления компании.");
    expect(html).not.toContain("не личная оценка профессиональных качеств");
    expect(html).toContain("Ваши ответы на открытые вопросы");
    expect(html).toContain("Какую проблему нужно решить?");
    expect(html).toContain("Согласовать роли.\nНаш план &lt;script&gt;не HTML&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("Ответ не указан.");
    expect(html.indexOf("Какую проблему нужно решить?")).toBeLessThan(html.indexOf("Что можно улучшить?"));
  });
  it("keeps the existing result readable during a rolling migration without open-answer fields", () => {
    const html = renderToStaticMarkup(createElement(ParticipantResultView, {result: {...result, open_answers: undefined} as unknown as ParticipantResult}));
    expect(html).toContain("Индекс управляемости по вашим ответам");
    expect(html).not.toContain("Ваши ответы на открытые вопросы");
  });
});
