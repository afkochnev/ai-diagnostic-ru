import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizePdfText, renderPdfHtml } from "@/server/pdf/render";
import { TEAM_BRAND_ASSET } from "@/shared/analytics/team-report-presentation";
import type { ParticipantResult } from "./participant-result-contracts";

const escape = (value: unknown) => normalizePdfText(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const number = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

export function buildParticipantResultPdfHtml(result: ParticipantResult): string {
  const logo = `data:image/png;base64,${readFileSync(path.join(process.cwd(), TEAM_BRAND_ASSET)).toString("base64")}`;
  const date = new Date(result.completed_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const openAnswers = (result.open_answers ?? []).map(item => `<section class="answer-section"><p class="muted">${escape(item.block_title)}</p><h3>${escape(item.prompt)}</h3><p class="answer">${escape(item.answer ?? "Ответ не указан.")}</p></section>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Ваш результат командной диагностики</title><meta name="author" content="iTeam"><style>
@page{size:A4;margin:18mm 18mm 18mm}*{box-sizing:border-box}body{font:10.5pt/1.4 Arial,"DejaVu Sans",sans-serif;color:#243746;margin:0}h1,h2,h3{color:#2f5774;line-height:1.2;break-after:avoid}h1{font-size:22pt;margin:12pt 0 8pt}h2{font-size:15pt;margin:15pt 0 7pt}h3{font-size:11pt;margin:6pt 0 7pt}p{margin:0 0 7pt}.logo{width:28mm;height:auto}.team{font-size:12pt;font-weight:bold;color:#2f5774;overflow-wrap:anywhere}.muted{color:#607887;font-size:9pt}.summary{background:#eef3f6;border-left:4pt solid #2f5774;padding:11pt 14pt;margin:13pt 0;break-inside:avoid}.summary h2{margin:0 0 6pt;font-size:12pt}.score{font-size:33pt;font-weight:bold;color:#2f5774;line-height:1.1}.scale{font-size:12pt;color:#607887}.maturity{font-size:13pt;font-weight:bold;margin:6pt 0 0}table{width:100%;border-collapse:collapse;margin-top:8pt;font-size:10pt}thead{display:table-header-group}th{background:#eef3f6;color:#2f5774;text-align:left}td,th{padding:5.5pt 10pt;border-bottom:1px solid #dce4e9;vertical-align:top;overflow-wrap:anywhere}tr{break-inside:avoid}th:last-child,td:last-child{text-align:right;white-space:nowrap;width:27%}.answer-section{margin:14pt 0}.answer-section>.muted{break-after:avoid;margin-bottom:4pt}.answer{white-space:pre-wrap;overflow-wrap:anywhere;orphans:2;widows:2}.privacy{border-top:1px solid #dce4e9;padding-top:8pt;margin-top:13pt;break-inside:avoid;font-size:9pt;color:#526877}.privacy strong{color:#243746}.name{overflow-wrap:anywhere}
</style></head><body>
<img class="logo" src="${logo}" alt="iTeam"><h1>Ваш результат<br>командной диагностики</h1>
<p class="team">${escape(result.team_title)}</p><p class="name">Участник: ${escape(result.display_name)}</p><p class="muted">Дата завершения: ${escape(date)}</p>
<p>Это ваша оценка системы управления компании.</p>
<section class="summary"><h2>Индекс управляемости по вашим ответам</h2><p><span class="score">${escape(number(result.overall_display))}</span> <span class="scale">из 100</span></p><p class="maturity">${escape(result.maturity_label)}</p></section>
<h2>Оценки по блокам</h2><p class="muted">Все показатели приведены к шкале от 0 до 100. Чем выше оценка, тем более системными и устойчивыми вы оцениваете управленческие практики. Особенности формулировок вопросов учтены при расчёте.</p>
<table><thead><tr><th>Блок диагностики</th><th>Оценка из 100</th></tr></thead><tbody>${result.blocks.map(block => `<tr><td>${escape(block.title)}</td><td>${escape(number(block.display_score))}</td></tr>`).join("")}</tbody></table>
${openAnswers ? `<h2>Ваши ответы на открытые вопросы</h2>${openAnswers}` : ""}
<aside class="privacy"><p><strong>Конфиденциальный индивидуальный результат</strong></p><p>Ваши ответы и индивидуальные оценки доступны только вам. Организатор видит статус прохождения, а результаты команды получает в сводном виде.</p><p>Результат рассчитан только по вашим ответам и может отличаться от общей оценки команды. AI-анализ не формировался.</p></aside>
</body></html>`;
}

export const renderParticipantResultPdf = (result: ParticipantResult) => renderPdfHtml(buildParticipantResultPdfHtml(result), { headerTemplate: "<div></div>" });
