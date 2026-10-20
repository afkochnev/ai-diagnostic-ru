import {describe,it,expect} from "vitest";
import {buildTeamPdfHtml,TEAM_PDF_TEMPLATE_VERSION,type TeamPdfInput} from "@/server/team/pdf-render";
import {reportFixture} from "../team/v3-fixtures";
const input=():TeamPdfInput=>({companyName:"FoodTech",teamTitle:"Система управления",completedAt:"2026-10-20T12:00:00Z",participantCount:3,index:"54,6",maturity:"Зона развития",blocks:[],content:reportFixture(),mock:false,profile:{participantCount:3,overall:{mean:54.5833333,stddev:18.9302677,maturity:"Зона развития"},blocks:[{position:1,title:"Стратегия",mean:54.1666667,stddev:22.4845626}],questions:[{number:3,position:1,blockPosition:1,blockTitle:"Стратегия",question:"Оценка практики без имён авторов",mean:1.3333333,stddev:1.247219128924647,participantCount:3}]}});
describe("branded Team PDF presentation",()=>{
 it("uses new template, canonical logo, site links, legend and raw dispersion labels",()=>{
  const value=input(),before=JSON.stringify(value),html=buildTeamPdfHtml(value);
  expect(TEAM_PDF_TEMPLATE_VERSION).toBe("team-report-v2");expect(html).toContain('alt="iTeam"');expect(html).toContain('src="data:image/png;base64,');expect(html).toContain('<a class="site" href="https://iteam.ru">iteam.ru</a>');
  for(const s of ["Командная диагностика","Как читать разброс оценок","Умеренный","Высокий","Очень высокий","Приложение с результатами оценки","не являются статистическим доказательством конфликта"])expect(html).toContain(s);
  expect(html.indexOf('class="results"')).toBeLessThan(html.indexOf('class="report-section"'));expect(html).toContain('data-dispersion-level="very_high">1,2');expect(JSON.stringify(value)).toBe(before);
 });
 it("preserves every substantive string without calling a provider or rewriting text",()=>{
  const v=input(),html=buildTeamPdfHtml(v),strings=(x:unknown):string[]=>typeof x==="string"?[x]:Array.isArray(x)?x.flatMap(strings):x&&typeof x==="object"?Object.values(x).flatMap(strings):[];
  for(const paragraph of strings(v.content)){
   const escaped=paragraph.normalize("NFC").replace(/[\u2010-\u2013]/g,"-").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
   for(const part of escaped.split(/\n+/).filter(Boolean))expect(html).toContain(part);
  }
 });
});
