import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";

export type ReportContent = Record<string, string | string[]>;
export type PdfInput = { companyName: string; completedAt: string | null; index: string; maturity: string; blocks: { title: string; score: string }[]; report: ReportContent };
const sections: [string, string][] = [["Краткое резюме", "summary"], ["Главный управленческий диагноз", "main_diagnosis"], ["Что означает текущий индекс управляемости", "manageability_index_text"], ["Сильные стороны системы управления", "strengths"], ["Ключевые проблемные зоны", "key_problem_zones"], ["Главное ограничение роста", "growth_constraint"], ["Риски, если ничего не менять", "implementation_risks"], ["Первые действия руководителя", "first_actions"], ["План на 30 дней", "plan_30_days"], ["План на 60 дней", "plan_60_days"], ["План на 90 дней", "plan_90_days"], ["Следующий рекомендуемый шаг", "next_step"]];
export function normalizePdfText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\uFFFE\uFFFF]/g, "-")
    .replace(/[\uFFFD\u00AD]/g, "")
    .replace(/[\u2010-\u2013]/g, "-")
    .replace(/[\u2028\u2029]/g, "\n");
}
const escapeHtml = (value: unknown) => normalizePdfText(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const body = (value: string | string[]) => Array.isArray(value) ? `<ul>${value.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${escapeHtml(value).replaceAll("\n", "<br>")}</p>`;
const logoDataUri = () => `data:image/png;base64,${readFileSync(path.join(process.cwd(), "public/brand/iteam-logo.png")).toString("base64")}`;
const coverLogoDataUri = () => `data:image/png;base64,${readFileSync(path.join(process.cwd(), "public/brand/iteam-logo-landing.png")).toString("base64")}`;

export function buildPdfHtml(input: PdfInput): string {
  const date = input.completedAt ? new Date(input.completedAt).toLocaleDateString("ru-RU") : "—";
  const blockTable = input.blocks.map((block) => `<div class="metric"><span>${escapeHtml(block.title)}</span><strong>${escapeHtml(block.score)}</strong></div>`).join("");
  const reportSections = sections.map(([title, key], index) => `<section class="report-section"><h2>${index + 1}. ${escapeHtml(title)}</h2>${body(input.report[key] ?? "")}</section>`).join("");
  const logo = coverLogoDataUri();
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
@page{size:A4;margin:18mm 17mm 18mm 17mm}*{box-sizing:border-box}body{font-family:Arial,"DejaVu Sans",sans-serif;color:#243746;font-size:10.5pt;line-height:1.48;margin:0}h1,h2,h3{color:#2F5774;margin:0 0 8pt}h1{font-size:28pt;line-height:1.15}h2{font-size:17pt;border-bottom:1px solid #d7e1e8;padding-bottom:5pt}p{margin:0 0 9pt}ul{margin:5pt 0 0 17pt;padding:0}li{margin:0 0 6pt}.cover{min-height:245mm;display:flex;flex-direction:column;justify-content:space-between}.logo{width:38.5mm;height:auto;display:block;margin-bottom:10pt}.eyebrow{color:#6d8494;text-transform:uppercase;letter-spacing:1.5pt;font-size:9pt}.rule{height:4pt;background:#2F5774;width:55mm;margin:16pt 0 20pt}.date{color:#607887;font-size:10pt}.summary{background:#f0f4f6;padding:13pt;border-left:4pt solid #2F5774;margin-top:18pt}.results{page-break-before:always}.metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:7pt;margin-top:12pt}.metric{border:1px solid #d8e2e8;border-radius:5pt;padding:8pt 10pt;display:flex;justify-content:space-between;gap:8pt}.metric strong{color:#2F5774;white-space:nowrap}.report-section{page-break-inside:avoid;margin-bottom:15pt}.group-page{page-break-before:always}.footer{color:#8295a0;font-size:8pt;border-top:1px solid #d8e2e8;padding-top:5pt;margin-top:12pt}
</style></head><body><div class="cover"><div><img class="logo" src="${logo}" alt="iTeam"><div class="eyebrow">iTeam · Управленческий AI-аудит компании</div><div class="rule"></div><h1>Управленческий<br>AI-аудит компании</h1><h2>${escapeHtml(input.companyName)}</h2><p class="date">Дата завершения диагностики: ${date}</p></div><div class="summary"><h3>Краткое резюме результатов</h3><p><b>Индекс управляемости:</b> ${escapeHtml(input.index)}</p><p><b>Уровень зрелости:</b> ${escapeHtml(input.maturity)}</p></div><div class="footer">Конфиденциальный отчёт · Сформирован из сохранённой версии</div></div><div class="results"><h2>Результаты диагностики</h2><div class="metric-grid">${blockTable}</div></div>${reportSections}</body></html>`;
}

export async function renderPdf(input: PdfInput): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });
  const timeoutMs = Math.min(300_000, Math.max(5_000, Number(process.env.PDF_RENDER_TIMEOUT_MS ?? 120_000)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rendering = (async () => {
      const page = await browser.newPage();
      await page.setContent(buildPdfHtml(input), { waitUntil: "load" });
      return page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;color:#8295a0;padding:0 17mm;"><img src="${logoDataUri()}" style="height:18px;width:auto;object-fit:contain;object-position:left center;"></div>`, footerTemplate: '<div style="width:100%;font-family:Arial, sans-serif;font-size:8px;color:#8295a0;text-align:right;padding:0 17mm;">https://iteam.ru · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("pdf_render_timeout")), timeoutMs);
    });
    return await Promise.race([rendering, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    await browser.close();
  }
}
