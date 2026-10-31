import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock('server-only',()=>({}));
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const data=vi.hoisted(()=>({individual:[] as unknown[],teams:[] as unknown[],enabled:true,entitled:false}));
vi.mock("@/server/diagnostic/service",()=>({getActiveDiagnostic:vi.fn(async()=>null),getLatestDiagnostics:vi.fn(async()=>data.individual)}));
vi.mock("@/server/entitlements",()=>({hasEntitlement:vi.fn(async()=>data.entitled)}));
vi.mock("@/server/team/service",()=>({listTeamHistory:vi.fn(async()=>data.teams)}));
vi.mock("@/server/team/capabilities",()=>({teamFoundationEnabled:()=>data.enabled}));
vi.mock("@/features/company/company-navigation",()=>({CompanyNavigation:()=>null}));
import { CompanyDashboard } from "@/features/company/company-dashboard";
import { RecentDiagnostics, recentDiagnostics, companyNextAction } from "@/features/company/recent-diagnostics";
import { listTeamHistory } from "@/server/team/service";
vi.stubGlobal("React",React);
const individual=(id="individual",day="2026-10-17",status="completed")=>({diagnostic:{id,status,started_at:day,completed_at:status==="completed"?day:null,submitted_at:null},result:status==="completed"?{display_manageability_index:54.6,maturity_label:"Зона развития"}:null});
const team=(id="foodtech",day="2026-10-18")=>({id,title:"Аудит системы управления FoodTech",status:"open",created_at:day,completedParticipants:3});
const company={id:"company",name:"FoodTech",account_id:"account",country:"Россия",employee_count:200} as Parameters<typeof CompanyDashboard>[0]["company"];
beforeEach(()=>{data.individual=[];data.teams=[];data.enabled=true;data.entitled=false;vi.clearAllMocks();});
describe("Company dashboard recent combined history",()=>{
  it("always offers Team with account and company context on Free",async()=>{
    data.enabled=false;
    const html=renderToStaticMarkup(await CompanyDashboard({company,userId:"owner"}));
    expect(html).toContain("Начать командную диагностику");
    expect(html).toContain('/ru/account/plan?account=account&amp;company=company');
    expect(listTeamHistory).not.toHaveBeenCalled();
  });
  it("takes Advanced to the same-company Team form",async()=>{
    data.entitled=true;
    const html=renderToStaticMarkup(await CompanyDashboard({company,userId:"owner"}));
    expect(html).toContain("Начать командную диагностику");
    expect(html).toContain('/ru/companies/company/diagnostics?new=1&amp;type=team#team-create');
  });
  it("loads and shows an existing Team even without individual results",async()=>{
    data.teams=[team()];const html=renderToStaticMarkup(await CompanyDashboard({company,userId:"owner"}));
    expect(listTeamHistory).toHaveBeenCalledWith("company");expect(html).toContain("Последние диагностики");expect(html).toContain("Аудит системы управления FoodTech");expect(html).toContain("Командная");expect(html).toContain("Завершили: 3");expect(html).toContain("Сбор ответов открыт");expect(html).toContain("/ru/companies/company/teams/foodtech");expect(html).not.toContain("Вы ещё не проходили диагностику");expect(html).not.toContain("Диагностик пока нет");expect(html).not.toContain("История индивидуальных диагностик");
  });
  it("merges dates, marks both types and preserves existing individual result links",()=>{
    const html=renderToStaticMarkup(React.createElement(RecentDiagnostics,{companyId:"company",individual:[individual()],teams:[team()]}));
    expect(html.indexOf("Командная")).toBeLessThan(html.indexOf("Индивидуальная"));expect(html).toContain("Завершена");expect(html).toContain("54,6");expect(html).toContain("17.10.2026");expect(html).toContain("/ru/diagnostics/individual/result");expect(html).toContain("Все диагностики");expect(html).toContain('href="/ru/companies/company/diagnostics"');
  });
  it("caps the overview at5 and sorts stable equal dates without losing in-progress status",()=>{
    const individuals=Array.from({length:5},(_,i)=>individual("i"+i,`2026-10-${10+i}`));const teams=[team("new","2026-10-18")];
    expect(recentDiagnostics(individuals,teams)).toHaveLength(5);expect(recentDiagnostics(individuals,teams)[0].id).toBe("new");
    const html=renderToStaticMarkup(React.createElement(RecentDiagnostics,{companyId:"company",individual:[individual("active","2026-10-18","in_progress")],teams:[]}));expect(html).toContain("В процессе");expect(html).toContain('href="/ru/diagnostics/active"');
  });
  it("shows neutral empty copy only if neither type exists and does not query disabled Team",async()=>{
    data.enabled=false;const html=renderToStaticMarkup(await CompanyDashboard({company,userId:"owner"}));expect(html).toContain("Диагностик пока нет.");expect(listTeamHistory).not.toHaveBeenCalled();
  });
});

describe("dashboard next action",()=>{
  it("prioritizes saved work over starting again or an older completed result",()=>{
    expect(companyNextAction("company","active",[individual()],[])).toMatchObject({href:"/ru/diagnostics/active",label:"Продолжить диагностику"});
  });
  it("opens an existing result and distinguishes waiting for a team",()=>{
    expect(companyNextAction("company",undefined,[individual()],[])).toMatchObject({href:"/ru/diagnostics/individual/result",label:"Открыть результаты и отчёт"});
    expect(companyNextAction("company",undefined,[],[{...team(),completedParticipants:2}])).toMatchObject({label:"Посмотреть готовность команды"});
    expect(companyNextAction("company",undefined,[],[team()])).toMatchObject({label:"Открыть командный результат"});
  });
  it("keeps processing diagnostics on the result route without starting another",()=>{
    expect(companyNextAction("company",undefined,[individual("pending","2026-10-18","submitted")],[])).toMatchObject({href:"/ru/diagnostics/pending/result",label:"Посмотреть статус результата"});
    expect(companyNextAction("company",undefined,[],[])).toMatchObject({href:"/ru/companies/company/diagnostics?new=1",label:"Начать диагностику"});
  });
});
