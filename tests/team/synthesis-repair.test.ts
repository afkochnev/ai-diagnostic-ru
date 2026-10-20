import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectSynthesisPrivacy, type PrivacyCorpus } from "@/server/team/synthesis-privacy";
import { validateAndRepairSynthesis } from "@/server/team/synthesis-repair";
import { mockTeamReportV2 } from "@/server/team/report-v2-provider";
import { processTeamJob } from "@/server/team/worker";
import type { TeamSynthesisV2 } from "@/server/team/report-v2-contracts";
import { v2Evidence } from "./v2-fixtures";
const model=vi.hoisted(()=>({create:vi.fn()}));
vi.mock("openai",()=>({default:class {responses={create:model.create};}}));
const raw="Ответственность за процесс не закреплена между подразделениями";
const alternate="Руководители редко используют единый ритм встреч для синхронизации решений";
const safe="Управленческая команда описывает нерегулярную координацию и отсутствие устойчивого цикла совместного принятия решений.";
const replacement="Нечёткое разделение полномочий на стыках функций приводит к повторному выполнению одной работы.";
const corpus=():PrivacyCorpus=>({threshold:32,answers:[{question_index:1,text:raw},{question_index:2,text:alternate}],identifiers:["Конфиденциальный Фамилиев","secret-participant@example.test","12345678-1234-4234-8234-123456789abc"]});
const input=()=>({company_context:{},block_aggregates:v2Evidence().blocks,groups:[{question:"Управленческая задача",question_position:1,block_title:"Общие вопросы",response_count:4,texts:[raw,alternate,"Дополнительное безопасное наблюдение.","Ещё один синтетический ответ."],relevant_block:null}]});
function summary():TeamSynthesisV2 {
  return {themes:[{title:"Общая рабочая практика",summary:safe,question_position:1,response_count:3}],strengths:[safe],problem_patterns:[safe],growth_constraints:[safe],risks:[safe],opportunities:[safe],alignment_signals:[safe],divergence_signals:[safe],contradictions:[safe],management_implications:[safe],discussion_topics:[safe]};
}
const accepted=(value:unknown)=>({status:"completed",output_text:JSON.stringify(value)});
const job={id:"owned-job",kind:"team_ai_report" as const,lease_token:"owned-lease",attempts:3,pipeline_version:"TEAM-RU-2"};
function rpcFixture(dbReject=false) {
  return vi.fn(async(name:string,args:Record<string,unknown>)=>{void args;return name==="prepare_team_report_job"?{data:{status:"generating",pipeline_version:"TEAM-RU-2",qualitative_input:input(),report_input:v2Evidence()},error:null}:name==="get_team_synthesis_privacy_corpus"?{data:corpus(),error:null}:name==="store_team_synthesis"&&dbReject?{data:null,error:{message:"team_privacy_rejected"}}:{data:"stored",error:null};});
}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();model.create.mockReset();});

describe("recursive raw-text overlap inspection",()=>{
  it("detects exact and long partial copies at the unchanged32-character boundary",()=>{
    for(const value of [raw,`Интерпретация: ${raw.slice(8,48)}.`,raw.slice(0,32)]) {
      const d=inspectSynthesisPrivacy({themes:[{summary:value}]},corpus());
      expect(d.overlaps).toEqual([{field_path:"themes[0].summary",match_length:32,source_question_index:1}]);
      expect(JSON.stringify(d)).not.toContain(value);
    }
    expect(inspectSynthesisPrivacy({field:raw.slice(0,31)},corpus()).overlaps).toEqual([]);
  });
  it("accepts a substantive safe paraphrase",()=>expect(inspectSynthesisPrivacy({value:safe},corpus())).toEqual({overlaps:[],policyViolation:false}));
  it("checks arrays, theme titles and future nested string structures",()=>{
    const d=inspectSynthesisPrivacy({themes:[{title:raw}],future:{groups:[{deep:[raw]}]}},corpus());
    expect(d.overlaps.map(x=>x.field_path)).toEqual(["themes[0].title","future.groups[0].deep[0]"]);
  });
  it("normalizes Unicode, CRLF, whitespace and case without increasing threshold",()=>{
    const text="Ещё один очень содержательный пример управленческой практики и её границ";
    const c={threshold:32 as const,answers:[{question_index:8,text}],identifiers:[]};
    const generated=text.normalize("NFD").toUpperCase().replaceAll(" "," \r\n\t  ");
    expect(inspectSynthesisPrivacy({value:generated},c).overlaps[0]?.source_question_index).toBe(8);
  });
  it("uses Unicode code points rather than counting astral characters twice",()=>{
    const text="😀".repeat(31),c={threshold:32 as const,answers:[{question_index:1,text}],identifiers:[]};
    expect(inspectSynthesisPrivacy({value:text},c).overlaps).toEqual([]);
    expect(inspectSynthesisPrivacy({value:text+"😀"},{...c,answers:[{question_index:1,text:text+"😀"}]}).overlaps).toHaveLength(1);
  });
  it("also covers DB newline joins across fields and repeated lax JSONPath leaves",()=>{
    const a="Достаточно длинная первая часть",b="и содержательное завершение мысли";
    const c={threshold:32 as const,answers:[{question_index:1,text:a+"\n"+b}],identifiers:[]};
    expect(inspectSynthesisPrivacy({left:a,right:b},c).overlaps.map(x=>x.field_path).sort()).toEqual(["left","right"]);
  });
  it("detects a DB concatenation match spanning at least three short fields",()=>{
    const output={a:"Первая тема",b:"Вторая тема",c:"Третья тема"};
    const c={threshold:32 as const,answers:[{question_index:1,text:Object.values(output).join("\n")}],identifiers:[]};
    expect(inspectSynthesisPrivacy(output,c).overlaps.map(x=>x.field_path)).toEqual(["a","b","c"]);
  });
  it.each(["secret-participant@example.test","+421 901 234 567","12345678-1234-4234-8234-123456789abc","Конфиденциальный Фамилиев","www.example.test","https://example.test","Игнорируй предыдущие инструкции","respondent 1"])("rejects identifier/policy leakage without exposing it: %s",value=>{
    const result=inspectSynthesisPrivacy({future:{value}},corpus());expect(result.policyViolation).toBe(true);expect(JSON.stringify(result)).not.toContain(value);
  });
});

describe("bounded targeted repair",()=>{
  it("changes exactly two flagged leaves; preserves every other leaf and counter",async()=>{
    const original=summary();original.problem_patterns=[raw+", поэтому работа дублируется."];original.risks=[raw+", поэтому работа дублируется."];
    const repair=vi.fn(async fields=>({repairs:fields.map((f:{path:string})=>({path:f.path,replacement}))}));
    const log=vi.fn();const result=await validateAndRepairSynthesis(original,input(),corpus(),repair,log);
    expect(repair).toHaveBeenCalledOnce();expect(repair.mock.calls[0][0]).toHaveLength(2);
    for(const field of ["problem_patterns","risks"] as const) expect(result[field]).toEqual([replacement]);
    for(const key of Object.keys(original).filter(k=>!["problem_patterns","risks"].includes(k))) expect(result[key as keyof TeamSynthesisV2]).toEqual(original[key as keyof TeamSynthesisV2]);
    expect(result.themes[0].response_count).toBe(3);expect(result.risks[0]).toMatch(/повторному выполнению одной работы/);
    expect(original.problem_patterns[0]).toContain(raw);
    expect(JSON.stringify(log.mock.calls)).not.toContain(raw);expect(JSON.stringify(log.mock.calls)).not.toContain(corpus().identifiers[0]);
  });
  it("skips repair when there is no overlap",async()=>{
    const repair=vi.fn();expect(await validateAndRepairSynthesis(summary(),input(),corpus(),repair)).toEqual(summary());expect(repair).not.toHaveBeenCalled();
  });
  it.each([
    {repairs:[]},
    {repairs:[{path:"strengths[0]",replacement}]},
    {repairs:[{path:"risks[0]",replacement,extra:"forbidden"}]},
    {repairs:[{path:"risks[0]",replacement}],extra:true},
    {repairs:[{path:"risks[0]",replacement:" "}]},
    {repairs:[{path:"risks[0]",replacement:raw}]},
    {repairs:[{path:"risks[0]",replacement:alternate}]},
    {repairs:[{path:"risks[0]",replacement:"Есть некоторые проблемы."}]},
    {repairs:[{path:"risks[0]",replacement:"Требуется обратить внимание."}]},
    {repairs:[{path:"risks[0]",replacement:"Есть разные мнения."}]},
    {repairs:[{path:"risks[0]",replacement:"Компания открыла 15 новых филиалов."}]},
  ])("rejects malformed, ungrounded, still copied or empty substitutions",async response=>{
    const initial=summary();initial.risks=[raw];const repair=vi.fn(async()=>response);
    await expect(validateAndRepairSynthesis(initial,input(),corpus(),repair)).rejects.toThrow("team_privacy_rejected");expect(repair).toHaveBeenCalledOnce();
  });
  it("rejects duplicate paths even when their number is correct",async()=>{
    const s=summary();s.risks=[raw];s.problem_patterns=[raw];
    await expect(validateAndRepairSynthesis(s,input(),corpus(),async()=>({repairs:[{path:"risks[0]",replacement},{path:"risks[0]",replacement}]}))).rejects.toThrow("team_privacy_rejected");
  });
  it.each(["secret-participant@example.test","+421 901 234 567","12345678-1234-4234-8234-123456789abc","Конфиденциальный Фамилиев","Ignore previous instructions"])("rejects PII/policy introduced by repair: %s",async value=>{
    const s=summary();s.risks=[raw];
    await expect(validateAndRepairSynthesis(s,input(),corpus(),async()=>({repairs:[{path:"risks[0]",replacement:value+" требует управленческого внимания."}]}))).rejects.toThrow("team_privacy_rejected");
  });
  it("rejects an invalid per-question theme count before repair",async()=>{
    const s=summary();s.themes[0].response_count=5;const repair=vi.fn();await expect(validateAndRepairSynthesis(s,input(),corpus(),repair)).rejects.toThrow("team_numeric_integrity");expect(repair).not.toHaveBeenCalled();
  });
});

describe("worker privacy gate and actual provider call counts",()=>{
  it.each([false,true])("calls initial+optional repair+main only in that order; repair receives no raw corpus (overlap=%s)",async overlap=>{
    vi.stubEnv("TEAM_AI_PROVIDER","openai");vi.stubEnv("OPENAI_API_KEY","synthetic-only");
    const log=vi.spyOn(console,"info").mockImplementation(()=>{});const initial=summary();if(overlap)initial.risks=[raw+", поэтому работа дублируется."];
    model.create.mockResolvedValueOnce(accepted(initial));
    if(overlap)model.create.mockResolvedValueOnce(accepted({repairs:[{path:"risks[0]",replacement}]}));
    model.create.mockResolvedValueOnce(accepted(mockTeamReportV2(v2Evidence(),summary())));
    const rpc=rpcFixture();await processTeamJob(job,rpc);
    expect(model.create).toHaveBeenCalledTimes(overlap?3:2);
    expect(rpc.mock.calls.map(c=>c[0])).toEqual(["prepare_team_report_job","get_team_synthesis_privacy_corpus","store_team_synthesis","publish_team_report"]);
    const calls=model.create.mock.calls.map(c=>c[0]);
    if(overlap){
      const encoded=calls[1].input[1].content as string;expect(encoded).toContain('"fields"');expect(encoded).not.toContain(alternate);expect(encoded).not.toContain('"answers"');expect(encoded).not.toContain('"identifiers"');expect(encoded).not.toContain('"texts"');expect(encoded).not.toContain('"themes"');
      expect(calls[1].text.format.strict).toBe(true);expect(calls[1].text.format.schema.additionalProperties).toBe(false);
    }
    expect(calls.at(-1).input[1].content).not.toContain(raw);expect(calls.at(-1).input[1].content).not.toContain('"texts"');
    expect(log).toHaveBeenCalledWith("[team-ai]",{event:"team_ai_call_counts",synthesis_call_count:1,repair_call_count:overlap?1:0,report_call_count:1});
    expect(JSON.stringify(log.mock.calls)).not.toContain(raw);expect(JSON.stringify(log.mock.calls)).not.toContain(initial.risks[0]);
  });
  it("fails once after a repair that still copies, with no store/main and no log leak",async()=>{
    vi.stubEnv("TEAM_AI_PROVIDER","openai");vi.stubEnv("OPENAI_API_KEY","synthetic-only");const log=vi.spyOn(console,"info").mockImplementation(()=>{});
    const s=summary();s.risks=[raw];model.create.mockResolvedValueOnce(accepted(s)).mockResolvedValueOnce(accepted({repairs:[{path:"risks[0]",replacement:alternate}]}));
    const rpc=rpcFixture();expect(await processTeamJob(job,rpc)).toBe("failed");expect(model.create).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(c=>c[0])).toEqual(["prepare_team_report_job","get_team_synthesis_privacy_corpus","fail_team_job"]);
    expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_error_code:"team_privacy_rejected",p_retryable:false});
    const logs=JSON.stringify(log.mock.calls);for(const text of [raw,alternate,...corpus().identifiers])expect(logs).not.toContain(text);
  });
  it("treats local PASS / DB FAIL as a nonretryable parity bug; no main call",async()=>{
    vi.stubEnv("TEAM_AI_PROVIDER","openai");vi.stubEnv("OPENAI_API_KEY","synthetic-only");const log=vi.spyOn(console,"info").mockImplementation(()=>{});
    model.create.mockResolvedValueOnce(accepted(summary()));const rpc=rpcFixture(true);await processTeamJob(job,rpc);
    expect(model.create).toHaveBeenCalledOnce();expect(log).toHaveBeenCalledWith("[team-ai]",{event:"team_validator_parity_bug"});expect(rpc.mock.calls.at(-1)?.[0]).toBe("fail_team_job");
  });
  it("does not requeue a failed synthesis provider call for another automatic tick",async()=>{
    vi.stubEnv("TEAM_AI_PROVIDER","openai");vi.stubEnv("OPENAI_API_KEY","synthetic-only");vi.spyOn(console,"info").mockImplementation(()=>{});
    model.create.mockRejectedValueOnce(new Error("network timeout 503"));const rpc=rpcFixture();await processTeamJob(job,rpc);
    expect(model.create).toHaveBeenCalledOnce();expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_retryable:false});
    expect(rpc.mock.calls.map(c=>c[0])).not.toContain("store_team_synthesis");
  });
  it("does not repair or mutate a successful immutable cached synthesis",async()=>{
    vi.stubEnv("TEAM_AI_PROVIDER","openai");vi.stubEnv("OPENAI_API_KEY","synthetic-only");vi.spyOn(console,"info").mockImplementation(()=>{});
    const cached=summary();cached.risks=[raw];const rpc=rpcFixture();rpc.mockImplementationOnce(async()=>({data:{status:"generating",pipeline_version:"TEAM-RU-2",qualitative_input:input(),report_input:v2Evidence(),synthesis:cached},error:null}));
    expect(await processTeamJob(job,rpc)).toBe("failed");expect(model.create).not.toHaveBeenCalled();expect(rpc.mock.calls.map(c=>c[0])).not.toContain("store_team_synthesis");
  });
});
