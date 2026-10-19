import { buildPdfHtml, normalizePdfText, renderPdfHtml } from "@/server/pdf/render";
import { teamReportV2Schema } from "./report-v2-contracts";
import { teamDynamicsSections } from "@/features/team/rich-report";
export type TeamPdfInput={companyName:string;teamTitle:string;completedAt:string;participantCount:number;index:string;maturity:string;blocks:{title:string;score:string}[];content:unknown;mock:boolean};
const escape=(v:unknown)=>normalizePdfText(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
export function buildTeamPdfHtml(input:TeamPdfInput) {
  const content=teamReportV2Schema.parse(input.content);
  const {team_analysis,participant_count,...report}=content;void participant_count;
  const base=buildPdfHtml({companyName:input.companyName,completedAt:input.completedAt,index:input.index,maturity:input.maturity,blocks:input.blocks,report});
  const dynamics=teamDynamicsSections.map(([title,key],i)=>`<section class="report-section"><h2>${i+13}. ${escape(i===2?"Дополнительные качественные сигналы команды":title)}</h2>${team_analysis[key].length?`<ul>${team_analysis[key].map(p=>`<li>${escape(p)}</li>`).join("")}</ul>`:"<p>Допустимых дополнительных свидетельств нет.</p>"}</section>`).join("");
  return base.replace("Управленческий<br>AI-аудит компании","Командный управленческий<br>AI-аудит")
    .replace(`<h2>${escape(input.companyName)}</h2>`,`<h2>${escape(input.companyName)}</h2><p>${escape(input.teamTitle)}</p><p>Завершивших участников: ${input.participantCount}</p>${input.mock?'<div class="summary"><b>Тестовый отчёт</b><p>Создан тестовым провайдером и не предназначен для оценки качества AI-анализа.</p></div>':""}`)
    .replace("Дата завершения диагностики:","Дата отчёта:")
    .replace("Результаты диагностики</h2>","Результаты командной диагностики</h2>")
    .replace("Что означает текущий индекс управляемости","Что означает командный индекс управляемости")
    .replace("</body>",`<div class="group-page"><h2>Командная динамика</h2>${dynamics}</div></body>`);
}
export const renderTeamPdf=(input:TeamPdfInput)=>renderPdfHtml(buildTeamPdfHtml(input));
