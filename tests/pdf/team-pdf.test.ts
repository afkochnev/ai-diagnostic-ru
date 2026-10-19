import { describe, expect, it } from "vitest";
import { buildTeamPdfHtml } from "@/server/team/pdf-render";
import { reportFixture, meanEvidence } from "../team/v3-fixtures";
import { teamCoreSections, teamDynamicsSections } from "@/features/team/rich-report";
describe("Team PDF content",()=>{
  it("contains cover, aggregate means and every numbered core/dynamics section, with visible mock disclosure",()=>{
    const e=meanEvidence(),html=buildTeamPdfHtml({companyName:"FoodTech",teamTitle:"Проверка системы управления",completedAt:"2026-10-19T07:00:00Z",participantCount:4,index:"50",maturity:"Зона развития",blocks:e.blocks.map(b=>({title:b.title,score:String(b.mean)})),content:reportFixture(),mock:true});
    for(const word of ["Командный управленческий","FoodTech","Проверка системы управления","Завершивших участников: 4","50","Зона развития","Результаты командной диагностики","Тестовый отчёт","не предназначен для оценки качества AI-анализа"])expect(html).toContain(word);
    teamCoreSections.forEach(([title],i)=>expect(html).toContain(`${i+1}. ${title}`));
    teamDynamicsSections.forEach(([title],i)=>expect(html).toContain(`${i+13}. ${i===2?"Дополнительные качественные сигналы команды":title}`));
    expect(html).toContain('class="group-page"');
    for(const forbidden of ["member@example.test","Анна","Задача многократно возвращается на утверждение сверху","participant_id","individual_score"])expect(html).not.toContain(forbidden);
  });
  it("escapes cover metadata and real reports do not inherit a mock label",()=>{
    const html=buildTeamPdfHtml({companyName:"<Company>",teamTitle:"<script>secret</script>",completedAt:"2026-10-19T07:00:00Z",participantCount:4,index:"50",maturity:"Зона развития",blocks:[],content:reportFixture(),mock:false});
    expect(html).toContain("&lt;Company&gt;");expect(html).not.toContain("<script>");expect(html).not.toContain("Тестовый отчёт");
  });
});
