import { describe, expect, it } from "vitest";
import { buildPdfHtml, normalizePdfText, type PdfInput } from "@/server/pdf/render";

const input: PdfInput = {
  companyName: "МедТех",
  completedAt: "2026-09-10T12:00:00Z",
  index: "61,6",
  maturity: "Зона развития",
  blocks: [
    ["Стратегия", "75"], ["Организационная структура", "62,5"], ["Бизнес-процессы", "57,5"], ["Цели и показатели", "62,5"],
    ["Управленческий ритм", "60"], ["Команда и управленческая зрелость", "62,5"], ["Мотивация и ответственность", "60"], ["Корпоративная культура", "52,5"],
  ].map(([title, score]) => ({ title, score })),
  report: {
    summary: "Содержательное резюме.", main_diagnosis: "Диагноз.", manageability_index_text: "Интерпретация.",
    strengths: ["Сильная сторона"], key_problem_zones: ["Проблемная зона"], growth_constraint: "Ограничение роста.",
    implementation_risks: ["Риск"], first_actions: ["Действие"], plan_30_days: ["План 30"], plan_60_days: ["План 60"], plan_90_days: ["План 90"], next_step: "Следующий шаг.",
  },
};

describe("PDF report template", () => {
  it("contains company, results, all blocks and numbered report sections", () => {
    const html = buildPdfHtml(input);
    expect(html).toContain("МедТех");
    expect(html).toContain("61,6");
    expect(html).toContain("Зона развития");
    for (const title of input.blocks.map((b) => b.title)) expect(html).toContain(title);
    const titles = ["Краткое резюме", "Главный управленческий диагноз", "Что означает текущий индекс управляемости", "Сильные стороны системы управления", "Ключевые проблемные зоны", "Главное ограничение роста", "Риски, если ничего не менять", "Первые действия руководителя", "План на 30 дней", "План на 60 дней", "План на 90 дней", "Следующий рекомендуемый шаг"];
    titles.forEach((title, i) => expect(html).toContain(`${i + 1}. ${title}`));
  });

  it("escapes user content and omits technical metadata", () => {
    const html = buildPdfHtml({ ...input, companyName: "<МедТех>", report: { ...input.report, summary: "</p><script>alert(1)</script>" } });
    expect(html).toContain("&lt;МедТех&gt;");
    expect(html).not.toContain("<script>");
    for (const forbidden of ["structured_content", "provider_request_id", "AI_REPORT_SCHEMA_RU_1_0", "OPENAI_API_KEY"]) expect(html).not.toContain(forbidden);
  });

  it("uses A4 pagination and natural numeric display values", () => {
    const html = buildPdfHtml(input);
    expect(html).toContain("@page{size:A4");
    expect(html).not.toContain("75,0");
    expect(html).not.toContain("60,0");
    expect(html).toContain("52,5");
    expect(html).toContain("62,5");
  });

  it("normalizes malformed separators without changing report meaning", () => {
    expect(normalizePdfText("Бизнес￾процессы")).toBe("Бизнес-процессы");
    expect(normalizePdfText("Бизнес\u2011процессы")).toBe("Бизнес-процессы");
    expect(normalizePdfText("текст\u00ADтекст")).toBe("тексттекст");
    expect(buildPdfHtml({ ...input, blocks: [{ title: "Бизнес￾процессы", score: "57,5" }, ...input.blocks.slice(1)] })).toContain("Бизнес-процессы");
  });

  it("includes Chromium page number footer configuration", () => {
    expect(buildPdfHtml(input)).toContain("Конфиденциальный отчёт");
    expect(buildPdfHtml(input)).toContain('class="logo"');
    expect(buildPdfHtml(input)).toContain("data:image/png;base64,");
  });

});
