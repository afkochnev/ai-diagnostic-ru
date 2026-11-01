import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state=vi.hoisted(()=>({active:null as {id:string}|null,individual:[] as unknown[]}));
vi.mock("server-only",()=>({}));
vi.mock("@/server/acquisition/contracts",()=>({acquisitionEnabled:()=>false}));
vi.mock("@/features/company/company-navigation",()=>({CompanyNavigation:()=>null}));
vi.mock("@/server/diagnostic/service",()=>({getActiveDiagnostic:async()=>state.active,getLatestDiagnostics:async()=>state.individual}));
vi.mock("@/server/entitlements",()=>({hasEntitlement:async()=>false}));
vi.mock("@/server/team/capabilities",()=>({teamFoundationEnabled:()=>false}));
vi.mock("@/server/team/service",()=>({listTeamHistory:async()=>[]}));
import { CompanyDashboard } from "@/features/company/company-dashboard";
const company={id:"company",account_id:"account",name:"Компания посетителя",country:"Россия",employee_count:20} as Parameters<typeof CompanyDashboard>[0]["company"];
const markup=async()=>renderToStaticMarkup(await CompanyDashboard({company,userId:"owner"}));
function primaryLinks(html:string){return [...html.matchAll(/<a\b[^>]*>[^<]*<\/a>/g)].map(match=>match[0]).filter(link=>/class="[^"]*bg-brand(?:\s|")/.test(link));}
beforeEach(()=>{state.active=null;state.individual=[];vi.stubGlobal("React",React);});

describe("active diagnostic dashboard controls",()=>{
  it("identifies the current company and places the next action before profile details",async()=>{
    const html=await markup();
    expect(html).toMatch(/<h1[^>]*>Компания посетителя<\/h1>/);
    expect(html).toContain("Диагностика системы управления");
    expect(html.indexOf("Начните с диагностики")).toBeLessThan(html.indexOf("Сведения о компании"));
  });
  it("opens the unified chooser without creating a diagnostic from the dashboard",async()=>{
    const html=await markup();const primary=primaryLinks(html);
    expect(primary).toHaveLength(1);expect(primary[0]).toContain('href="/ru/companies/company/diagnostics?new=1"');
    expect(primary[0]).toContain("Начать диагностику");
    expect(html).not.toContain("<form");
  });
  it("makes the saved attempt primary and routes new diagnostics through the shared mode chooser",async()=>{
    state.active={id:"active"};state.individual=[{diagnostic:{id:"active",status:"in_progress",completed_at:null},result:null}];
    const html=await markup();const primary=primaryLinks(html);
    expect(primary).toHaveLength(1);expect(primary[0]).toContain('href="/ru/diagnostics/active"');
    expect(primary[0]).toContain("Продолжить диагностику");
    expect(html).toContain('href="/ru/companies/company/diagnostics?new=1"');
    expect(html).toContain("Новая диагностика");
    expect(html).not.toContain("Начать командную диагностику");
    expect(html).not.toContain('/ru/account/plan');
  });
});
