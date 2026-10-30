import { describe, expect, it } from "vitest";
import { buildParticipantResultPdfHtml } from "@/server/team/participant-result-pdf-render";
import type { ParticipantResult } from "@/server/team/participant-result-contracts";

const fixture: ParticipantResult = {
  status: "completed", participant_id: "10000000-0000-4000-8000-000000000001", display_name: "Анна <script>secret</script>", team_title: "Команда <Food & Tech>", completed_at: "2026-10-30T12:00:00Z", overall_raw: 62.875, overall_display: 62.9, maturity_label: "Системное управление",
  blocks: Array.from({ length: 8 }, (_, i) => ({ block_id: `block-${i}`, title: `Блок ${i + 1} <практика>`, position: i + 1, raw_score: 55.55 + i, display_score: 55.6 + i, question_count: 10 })),
};

describe("participant result PDF", () => {
  it("contains only the self result, eight block scores, date, maturity and privacy explanation", () => {
    const html = buildParticipantResultPdfHtml(fixture);
    for (const text of ["Ваш результат", "командной диагностики", "62,9", "Системное управление", "30 октября 2026", "не личная оценка профессиональных качеств", "AI-анализ не формировался", "Конфиденциальный индивидуальный результат"]) expect(html).toContain(text);
    expect(html.match(/<tr><td>/g)).toHaveLength(8);
    expect(html).not.toContain("participant_id");
    expect(html).not.toContain("Индекс команды");
  });
  it("escapes participant, team and block titles before they enter the HTML renderer", () => {
    const html = buildParticipantResultPdfHtml(fixture);
    expect(html).not.toContain("<script>");
    expect(html).toContain("Анна &lt;script&gt;secret&lt;/script&gt;");
    expect(html).toContain("Команда &lt;Food &amp; Tech&gt;");
    expect(html).toContain("Блок 1 &lt;практика&gt;");
    expect(html).toContain("data:image/png;base64,");
  });
});
