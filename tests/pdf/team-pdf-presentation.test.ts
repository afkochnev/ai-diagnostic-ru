import {describe,it,expect} from "vitest";
import {buildTeamPdfHtml,TEAM_PDF_TEMPLATE_VERSION,type TeamPdfInput} from "@/server/team/pdf-render";
import {reportFixture} from "../team/v3-fixtures";
const input=():TeamPdfInput=>({companyName:"FoodTech",teamTitle:"Система управления",completedAt:"2026-10-20T12:00:00Z",participantCount:3,index:"54,6",maturity:"Зона развития",blocks:[],content:reportFixture(),mock:false,profile:{participantCount:3,overall:{mean:54.5833333,stddev:18.9302677,maturity:"Зона развития"},blocks:[{position:1,title:"Стратегия",mean:54.1666667,stddev:22.4845626}],questions:[{number:3,position:1,blockPosition:1,blockTitle:"Стратегия",question:"Оценка практики без имён авторов",mean:1.3333333,stddev:1.247219128924647,participantCount:3}]}});
describe("branded Team PDF presentation",()=>{
 it("uses new template, canonical logo, site links, legend and normalized dispersion units",()=>{
  const value=input(),before=JSON.stringify(value),html=buildTeamPdfHtml(value);
  expect(TEAM_PDF_TEMPLATE_VERSION).toBe("team-report-v3-dispersion-percent-v2");expect(html).toContain('alt="iTeam"');expect(html).toContain('src="data:image/png;base64,');expect(html).toContain('<a class="site" href="https://iteam.ru">iteam.ru</a>');
  for(const s of ["Командная диагностика","Как читать разброс оценок","Умеренный","Высокий","Очень высокий","Приложение с результатами оценки","не являются статистическим доказательством конфликта","Наименьший разброс оценок","Наибольший разброс оценок"])expect(html).toContain(s);
  expect(html).not.toContain("Программные показатели к разделу");
  expect(html.indexOf('class="results"')).toBeLessThan(html.indexOf('class="report-section"'));expect(html).toContain('data-dispersion-level="very_high">31,2%');expect(JSON.stringify(value)).toBe(before);
 });
 it("preserves every substantive string without calling a provider or rewriting text",()=>{
  const v=input(),html=buildTeamPdfHtml(v),strings=(x:unknown):string[]=>typeof x==="string"?[x]:Array.isArray(x)?x.flatMap(strings):x&&typeof x==="object"?Object.values(x).flatMap(strings):[];
  for(const paragraph of strings(v.content)){
   const escaped=paragraph.normalize("NFC").replace(/[\u2010-\u2013]/g,"-").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
   for(const part of escaped.split(/\n+/).filter(Boolean))expect(html).toContain(part);
  }
 });
 it("renders compact plans and explains empty evidence lists without changing report content",()=>{
  const v=input(),report=reportFixture();
  report.strengths=[];report.key_problem_zones=[];report.implementation_risks=[];
  report.team_analysis.alignment=[];report.team_analysis.divergence=[];report.team_analysis.qualitative_signals=[];
  report.first_actions=report.first_actions.slice(0,1);report.plan_30_days=report.plan_30_days.slice(0,1);
  report.plan_60_days=report.plan_60_days.slice(0,1);report.plan_90_days=report.plan_90_days.slice(0,1);
  report.team_analysis.discussion_questions=report.team_analysis.discussion_questions.slice(0,1);
  v.content=report;const before=JSON.stringify(v),html=buildTeamPdfHtml(v);
  expect(html.match(/Недостаточно допустимых свидетельств для отдельного вывода\./g)).toHaveLength(6);
  expect(html).not.toContain("<ol></ol>");expect(html.match(/class="report-section"/g)).toHaveLength(16);
  expect(JSON.stringify(v)).toBe(before);
 });
});

 it("shows the same UAT dispersion percent in summary and appendix while preserving question means and input",()=>{
  const v=input();v.profile!.blocks[0].stddev=Math.sqrt(2/3)*25;
  v.profile!.questions[0].stddev=Math.sqrt(2/3);v.profile!.questions[0].mean=3;
  const before=JSON.stringify(v),html=buildTeamPdfHtml(v);
  expect(html).toContain("<th>Разброс,<br>% шкалы</th>");
  expect(html).toContain("<td>20,4%</td>");
  expect(html).toContain('data-dispersion-level="high">20,4%<br>');
  expect(html).not.toContain('data-dispersion-level="high">0,8');
  expect(html).toContain("<td>3</td>");expect(html).toContain("Разброс во всех таблицах показан в процентах");
  expect(JSON.stringify(v)).toBe(before);
 });
