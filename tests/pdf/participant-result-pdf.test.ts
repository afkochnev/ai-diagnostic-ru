import { describe, expect, it } from "vitest";
import { buildParticipantResultPdfHtml } from "@/server/team/participant-result-pdf-render";
import type { ParticipantResult } from "@/server/team/participant-result-contracts";

const fixture: ParticipantResult = {
  status: "completed", participant_id: "10000000-0000-4000-8000-000000000001", display_name: "Анна <script>secret</script>", team_title: "Команда <Food & Tech>", completed_at: "2026-10-30T12:00:00Z", overall_raw: 62.875, overall_display: 62.9, maturity_label: "Системное управление",
  blocks: Array.from({ length: 8 }, (_, i) => ({ block_id: `block-${i}`, title: `Блок ${i + 1} <практика>`, position: i + 1, raw_score: 55.55 + i, display_score: 55.6 + i, question_count: 10 })),
  open_answers: [
    { question_id: "own-1", position: 1, block_title: "Общая информация", prompt: "Какую проблему нужно решить?", answer: "Нужен общий план.\nСначала согласовать роли <важно>." },
    { question_id: "own-2", position: 83, block_title: "Открытые вопросы", prompt: "Что можно улучшить?", answer: null },
  ],
};

describe("participant result PDF", () => {
  it("contains only the self result, eight block scores, date, maturity and privacy explanation", () => {
    const html = buildParticipantResultPdfHtml(fixture);
    for (const text of ["Ваш результат", "командной диагностики", "62,9", "Системное управление", "30 октября 2026", "Это ваша оценка системы управления компании.", "AI-анализ не формировался", "Конфиденциальный индивидуальный результат", "Ваши ответы на открытые вопросы", "Какую проблему нужно решить?", "Нужен общий план.\nСначала согласовать роли &lt;важно&gt;.", "Ответ не указан."]) expect(html).toContain(text);
    expect(html.match(/<tr><td>/g)).toHaveLength(8);
    expect(html).not.toContain("participant_id");
    expect(html).not.toContain("Индекс команды");
    expect(html).not.toContain("не личная оценка профессиональных качеств");
  });
  it("escapes participant, team and block titles before they enter the HTML renderer", () => {
    const html = buildParticipantResultPdfHtml(fixture);
    expect(html).not.toContain("<script>");
    expect(html).toContain("Анна &lt;script&gt;secret&lt;/script&gt;");
    expect(html).toContain("Команда &lt;Food &amp; Tech&gt;");
    expect(html).toContain("Блок 1 &lt;практика&gt;");
    expect(html).toContain("data:image/png;base64,");
  });
  it("renders participant text as escaped multiline content and supports a pre-migration result without answers", () => {
    const html = buildParticipantResultPdfHtml({ ...fixture, open_answers: [{ ...fixture.open_answers[0], prompt: "Вопрос <script>bad</script>", answer: '<img src="https://private.example/steal">\nТолько собственный ответ' }] });
    expect(html).toContain("Вопрос &lt;script&gt;bad&lt;/script&gt;");
    expect(html).toContain("&lt;img src=&quot;https://private.example/steal&quot;&gt;\nТолько собственный ответ");
    expect(html).not.toContain('<img src="https://private.example');
    expect(html).toContain("white-space:pre-wrap;overflow-wrap:anywhere");
    expect(buildParticipantResultPdfHtml({ ...fixture, open_answers: undefined } as unknown as ParticipantResult)).not.toContain("Ваши ответы на открытые вопросы");
  });
});
