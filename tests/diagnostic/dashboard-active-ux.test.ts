vi.mock("@/server/locale", () => ({ requestLocale: async () => "ru" }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state=vi.hoisted(()=>({active:null as {id:string;status:string;revision:number;current_block_id:string;last_saved_at:string}|null,individual:[] as unknown[],teams:[] as unknown[]}));
vi.mock("server-only",()=>({}));
vi.mock("@/server/acquisition/contracts",()=>({acquisitionEnabled:()=>false}));
vi.mock("@/features/company/company-navigation",()=>({CompanyNavigation:()=>null}));
vi.mock("@/server/diagnostic/service",()=>({getActiveDiagnostic:async()=>state.active,getLatestDiagnostics:async()=>state.individual}));
vi.mock("@/server/entitlements",()=>({hasEntitlement:async()=>false}));
vi.mock("@/server/team/capabilities",()=>({teamFoundationEnabled:()=>true}));
vi.mock("@/server/team/service",()=>({listTeamHistory:async()=>state.teams}));
import { CompanyDashboard } from "@/features/company/company-dashboard";
const company={id:"company",account_id:"account",name:"Компания посетителя",country:"Россия",employee_count:20,products:"Оборудование и сервис",main_goals:"Сократить сроки выполнения заказов"} as Parameters<typeof CompanyDashboard>[0]["company"];
const active=(id="active")=>({id,status:"in_progress",revision:3,current_block_id:"block",last_saved_at:"2026-09-01"});
const markup=async()=>renderToStaticMarkup(await CompanyDashboard({company,userId:"owner"}));
function primaryLinks(html:string){return [...html.matchAll(/<a\b[^>]*>[^<]*<\/a>/g)].map(match=>match[0]).filter(link=>/class="[^"]*bg-brand(?:\s|")/.test(link));}
beforeEach(()=>{state.active=null;state.individual=[];state.teams=[];vi.stubGlobal("React",React);});

describe("active diagnostic dashboard controls",()=>{
  it("places the current company's data and profile action before the diagnostics list",async()=>{
    const html=await markup();
    expect(html).toMatch(/<h1[^>]*>Компания посетителя<\/h1>/);
    expect(html).toContain("Диагностика системы управления");
    expect(html).toContain("Сведения о компании");
    expect(html).toContain("Оборудование и сервис");
    expect(html).toContain('href="/ru/companies/company/profile"');
    expect(html.indexOf("Сведения о компании")).toBeLessThan(html.indexOf('id="recent-diagnostics-heading"'));
  });
  it("opens the unified chooser without creating a diagnostic from the dashboard",async()=>{
    const html=await markup();const primary=primaryLinks(html);
    expect(primary).toHaveLength(1);expect(primary[0]).toContain('href="/ru/companies/company/diagnostics?new=1"');
    expect(primary[0]).toContain("Новая диагностика");
    expect(html).not.toContain("<form");
  });
  it("keeps the saved attempt in one list row and new diagnostics in the same-company chooser",async()=>{
    state.active=active();state.individual=[{diagnostic:{...active(),completed_at:null},result:null}];
    const html=await markup();const primary=primaryLinks(html);
    expect(primary).toHaveLength(1);expect(primary[0]).toContain('href="/ru/companies/company/diagnostics?new=1"');
    expect(html.match(/href="\/ru\/diagnostics\/active"/g)).toHaveLength(1);
    expect(html).toContain("Продолжить");
    expect(html).toContain("Новая диагностика");
    expect(html).not.toContain("Начать командную диагностику");
    expect(html).not.toContain('/ru/account/plan');
    expect(html).not.toContain("Продолжите начатое");
  });
  it("keeps an older active attempt visible when more than five Team diagnostics are newer",async()=>{
    state.active=active();
    state.individual=[{diagnostic:{...active(),completed_at:null},result:null}];
    state.teams=Array.from({length:6},(_,index)=>({id:`team-${index}`,title:`Команда ${index}`,status:"open",created_at:`2026-10-${10+index}`,completedParticipants:3}));
    const html=await markup();
    expect(html.match(/href="\/ru\/diagnostics\/active"/g)).toHaveLength(1);
    for(let index=0;index<6;index++){expect(html).toContain(`href="/ru/companies/company/teams/team-${index}"`);}
  });
  it("adds the active attempt when ten newer Individual diagnostics have displaced it from the latest query",async()=>{
    state.active=active("older-active");
    state.individual=Array.from({length:10},(_,index)=>({diagnostic:{id:`completed-${index}`,status:"completed",started_at:`2026-10-${10+index}`,completed_at:`2026-10-${10+index}`},result:{display_manageability_index:50}}));
    const html=await markup();
    expect(html.match(/href="\/ru\/diagnostics\/older-active"/g)).toHaveLength(1);
    expect(html).toContain("В процессе");
    expect(html).toContain("Продолжить");
    expect(html).toContain('href="/ru/diagnostics/completed-0/result"');
    expect(html).toContain('href="/ru/diagnostics/completed-9/result"');
  });
});
