import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { mainTeamReportInputV3, qualitativeCoverage, validateCoreQuality, coreText } from "@/server/team/report-v3-contracts";
import { mockTeamReportV3, mockTeamSynthesisV3 } from "@/server/team/report-v3-provider";
import { inspectReportPrivacy } from "@/server/team/report-privacy";
import { calculateBlockScore, calculateOverall } from "@/server/scoring/engine";
import { preferredTeamReport, type TeamResults } from "@/server/team/results";
import { TeamResultsView } from "@/features/team/results";
vi.mock("@/features/team/result-actions",()=>({TeamResultForm:()=>null}));
vi.mock("@/features/team/report-progress",()=>({TeamReportProgress:()=>null}));
afterEach(()=>vi.unstubAllEnvs());
import { meanEvidence,qualitativeFixture,reportFixture } from "./v3-fixtures";
describe("TEAM-RU-3 average-first",()=>{
  it("separates primary means/evidence from dispersion and retains all 8/80 normalized observations",()=>{
    const e=meanEvidence(),s=mockTeamSynthesisV3(qualitativeFixture()),input=mainTeamReportInputV3(e,s);
    expect(input.PRIMARY_CORE_EVIDENCE.blocks).toHaveLength(8);expect(input.PRIMARY_CORE_EVIDENCE.questions).toHaveLength(80);
    expect(JSON.stringify(input.PRIMARY_CORE_EVIDENCE)).not.toMatch(/stddev|distribution|divergence|alignment|min":|max":/);
    expect(input.TEAM_DYNAMICS_EVIDENCE.questions[0].distribution).toHaveLength(5);
  });
  it("same means/different dispersion leaves all core fields identical, while dynamics change",()=>{
    const s=mockTeamSynthesisV3(qualitativeFixture());
    const a=mockTeamReportV3(mainTeamReportInputV3(meanEvidence(),s)),b=mockTeamReportV3(mainTeamReportInputV3(meanEvidence(true),s));
    expect(coreText(a)).toBe(coreText(b));expect(a.team_analysis).not.toEqual(b.team_analysis);
    validateCoreQuality(a,"mock",s);expect(coreText(a)).not.toMatch(/разброс|расхождени|противоположн|по-разному/);
  });
  it("same means/different open-answer mechanisms materially change core diagnosis and plans",()=>{
    const a=reportFixture(),s=mockTeamSynthesisV3(qualitativeFixture("metrics")),b=mockTeamReportV3(mainTeamReportInputV3(meanEvidence(),s));
    for(const key of ["summary","main_diagnosis","growth_constraint","implementation_risks","first_actions","plan_30_days","plan_60_days","plan_90_days","next_step"] as const)expect(a[key]).not.toEqual(b[key]);
    expect(a.main_diagnosis).toContain("вышестоящий уровень");expect(b.main_diagnosis).toContain("показателями");
  });
  it("required question with three distinct substantive responses produces input and nonempty management synthesis",()=>{
    const q=qualitativeFixture(),s=mockTeamSynthesisV3(q);const coverage=qualitativeCoverage(q,s);
    expect(coverage).toMatchObject({eligible_open_questions:1,groups_sent_to_synthesis:1});expect(coverage.non_empty_synthesis_sections).toBeGreaterThan(0);expect(s.themes.length).toBeGreaterThan(0);
    const empty=Object.fromEntries(Object.keys(s).map(k=>[k,[]]));expect(()=>qualitativeCoverage(q,empty)).toThrow("team_qualitative_insufficient");
    expect(qualitativeCoverage({...q,groups:[]},empty)).toEqual({eligible_open_questions:0,groups_sent_to_synthesis:0,non_empty_synthesis_sections:0,usable_qualitative_groups:0});
  });
  it("privacy-threshold zero-group case does not manufacture qualitative claims",()=>{
    const q={...qualitativeFixture(),groups:[]},s=mockTeamSynthesisV3(q),r=mockTeamReportV3(mainTeamReportInputV3(meanEvidence(),s));
    expect(s.themes).toEqual([]);expect(r.summary).toContain("качественный материал отсутствует");expect(r.team_analysis.qualitative_signals).toEqual([]);
  });
  it("mean-equivalent individual answers yield the same strengths/weaknesses and management priority",()=>{
    const e=meanEvidence(),blocks=e.blocks.map(b=>calculateBlockScore({block_id:b.title,block_weight:1,
      questions:e.questions.filter(q=>q.block_position===b.position).map(q=>({id:String(q.question_position),weight:1,reverse_score:q.reverse_score,is_required:true,is_active:true,answer_type:"scale_0_4"})),
      answers:e.questions.filter(q=>q.block_position===b.position).map(q=>({question_id:String(q.question_position),numeric_value:q.reverse_score?4-q.mean:q.mean}))}));
    blocks.forEach((b,i)=>expect(b.raw.toNumber()).toBe(e.blocks[i].mean));expect(calculateOverall(blocks.map(b=>({...b,block_weight:1}))).raw.toNumber()).toBe(e.overall.mean);
    const ranked=[...blocks].sort((a,b)=>b.raw.comparedTo(a.raw)),r=reportFixture();expect(r.strengths[0]).toContain(ranked[0].block_id);expect(r.key_problem_zones[0]).toContain(ranked.at(-1)!.block_id);expect(r.growth_constraint).toContain(ranked.at(-1)!.block_id);
  });
  it("rejects dynamics contamination, repeated filler and real mock labels",()=>{
    const r=reportFixture(),s=mockTeamSynthesisV3(qualitativeFixture());
    expect(()=>validateCoreQuality({...r,summary:r.summary+" Разброс показывает проблему."},"openai",s)).toThrow("team_quality_rejected");
    expect(()=>validateCoreQuality({...r,main_diagnosis:r.summary},"openai",s)).toThrow("team_quality_rejected");
    expect(()=>validateCoreQuality({...r,summary:"Тестовый отчёт компании"},"openai",s)).toThrow("team_quality_rejected");
  });
  it("does not require prescribed source words to accept an explanation based on participant responses",()=>{
    const r=reportFixture(),s=mockTeamSynthesisV3(qualitativeFixture());
    const withoutLabels={...r};
    for(const key of Object.keys(r) as (keyof typeof r)[]) {
      if(key==="team_analysis"||key==="participant_count")continue;
      const rewrite=(text:string)=>text.replace(/качествен\S*|открыт\S*|описан\S*/giu,"анкетные");
      const value=r[key];
      Object.assign(withoutLabels,{[key]:Array.isArray(value)?value.map(rewrite):rewrite(value)});
    }
    expect(coreText(withoutLabels)).not.toMatch(/качествен|открыт|описан/iu);
    expect(()=>validateCoreQuality(withoutLabels,"openai",s)).not.toThrow();
  });
  it("mock templates pass the complete raw corpus gate without copying open answers",()=>{
    const q=qualitativeFixture(),report=reportFixture();
    expect(inspectReportPrivacy(report,{threshold:32,answers:q.groups[0].texts.map(text=>({question_index:1,text})),identifiers:["Анна","member@example.test"]}).violations).toEqual([]);
  });
  it("prompt separates 12 core and 4 dynamics and mandates qualitative evidence; historical prompts untouched",()=>{
    const p=readFileSync("TEAM_REPORT_PROMPT_RU_3.md","utf8");for(const token of ["PRIMARY_CORE_EVIDENCE","TEAM_DYNAMICS_EVIDENCE","ЗАПРЕЩЕНО","stddev","qualitative_summary","RU-1.3","1–12","13–16"])expect(p).toContain(token);
    expect(readFileSync("TEAM_SYNTHESIS_PROMPT_RU_3.md","utf8")).toContain("НЕ число согласных");
  });
  it("prefers real completed reports over newer mock in exact pipeline/source and labels every mock",()=>{
    const reports=[{id:"real",version:3,status:"completed",source_fingerprint:"fp",prompt_version:"TEAM-RU-3",model:"gpt-5.6-sol",structured_content:reportFixture(),completed_participant_count:4,created_at:"2026-10-19T00:00:00Z",error_code:null},{id:"mock",version:4,status:"completed",source_fingerprint:"fp",prompt_version:"TEAM-RU-3",model:"team-mock-v3",structured_content:reportFixture(),completed_participant_count:4,created_at:"2026-10-19T00:00:00Z",error_code:null}];
    expect(preferredTeamReport(reports,"fp","TEAM-RU-3")?.id).toBe("real");
    const result:TeamResults={status:"ready",completed_count:4,fingerprint:"fp",overall:{overall_mean:50,overall_stddev:0,overall_min:50,overall_max:50},reports};
    const html=renderToStaticMarkup(createElement(TeamResultsView,{teamId:"team",result}));expect(html).toContain("Тестовый отчёт");expect(html).toContain("не предназначен для оценки качества AI-анализа");expect(html.match(/Скачать PDF/g)).toHaveLength(2);
  });
});
