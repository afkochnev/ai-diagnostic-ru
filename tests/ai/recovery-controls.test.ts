import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import * as React from "react";
import type {ReactNode,ReactElement} from "react";
import {readFileSync} from "node:fs";
const h=vi.hoisted(()=>({values:[] as unknown[],cursor:0,effects:[] as (()=>void|(()=>void))[]}));
vi.mock("react",async original=>({...await original<typeof import('react')>(),useState(initial:unknown){const i=h.cursor++;if(!(i in h.values))h.values[i]=initial;return[h.values[i],(v:unknown)=>{h.values[i]=v;}];},useRef(initial:unknown){const i=h.cursor++;if(!(i in h.values))h.values[i]={current:initial};return h.values[i];},useEffect(fn:()=>void|(()=>void)){h.effects.push(fn);}}));
import {AdminReportRegeneration} from "@/features/ai/admin-report-regeneration";
import {ReportRegenerationButton} from "@/features/ai/report-regeneration-button";
const fetcher=vi.fn(),reload=vi.fn();let cleanups:(()=>void)[]=[];
function render(fn:()=>ReactNode){h.cursor=0;h.effects=[];return fn();}
function nodes(n:ReactNode):ReactElement<{children?:ReactNode;onClick?:()=>void}>[]{if(Array.isArray(n))return n.flatMap(nodes);if(!React.isValidElement<{children?:ReactNode;onClick?:()=>void}>(n))return[];return[n,...nodes(n.props.children)];}
function mount(){for(const f of h.effects){const c=f();if(c)cleanups.push(c);}}
beforeEach(()=>{h.values=[];h.cursor=0;h.effects=[];cleanups=[];fetcher.mockReset();reload.mockReset();vi.useFakeTimers();vi.stubGlobal('React',React);vi.stubGlobal('fetch',fetcher);vi.stubGlobal('window',{location:{reload}});});
afterEach(()=>{cleanups.forEach(c=>c());vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
describe('Individual recovery controls',()=>{
 it('never selects historical provider error material for owner client props',()=>{
  const source=readFileSync('src/server/diagnostic/result.ts','utf8');
  expect(source).not.toContain('error_code');expect(source).not.toContain('error_message');
 });
 it('shows owner failed recovery label and the result page includes it for failed only',()=>{
  const tree=render(()=>ReportRegenerationButton({diagnosticId:'d',failed:true}));expect(nodes(tree).some(x=>x.type==='button'&&x.props.children==='Повторить формирование AI-отчёта')).toBe(true);
  const source=readFileSync('src/app/[locale]/(workspace)/diagnostics/[diagnosticId]/result/page.tsx','utf8');expect(source).toContain('data.aiReport?.status === "failed" && <ReportRegenerationButton diagnosticId={diagnosticId} failed />');expect(fetcher).not.toHaveBeenCalled();
 });
 it.each([['missing','Сформировать AI-отчёт'],['failed','Повторить формирование AI-отчёта'],['completed','Сформировать новую версию']] as const)('admin %s has deliberate action', (status,label)=>{
  const tree=render(()=>AdminReportRegeneration({diagnosticId:'d',initialStatus:status}));mount();expect(nodes(tree).some(x=>x.props.children===label)).toBe(true);expect(fetcher).not.toHaveBeenCalled();
 });
 it('admin action sends one POST even on double click and polls only the admin GET',async()=>{
  fetcher.mockResolvedValueOnce(Response.json({status:'queued'})).mockResolvedValueOnce(Response.json({status:'completed'}));
  const component=()=>AdminReportRegeneration({diagnosticId:'d',initialStatus:'failed'});
  const tree=render(component);const button=nodes(tree).find(x=>x.type==='button')!;button.props.onClick!();button.props.onClick!();await vi.advanceTimersByTimeAsync(0);
  render(component);mount();await vi.advanceTimersByTimeAsync(1500);
  expect(fetcher.mock.calls).toEqual([['/api/admin/diagnostics/d/reports',{method:'POST',cache:'no-store'}],['/api/admin/diagnostics/d/reports',{method:'GET',cache:'no-store'}]]);expect(reload).toHaveBeenCalledOnce();
 });
 it.each(['queued','generating'] as const)('pending %s polls with no mutation or button',async initialStatus=>{
  fetcher.mockResolvedValue(Response.json({status:initialStatus}));const tree=render(()=>AdminReportRegeneration({diagnosticId:'d',initialStatus}));mount();await vi.advanceTimersByTimeAsync(1500);expect(nodes(tree).some(x=>x.type==='button')).toBe(false);expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/admin/diagnostics/d/reports',{method:'GET',cache:'no-store'});
 });
});
