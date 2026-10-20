import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { processTeamJob } from "@/server/team/worker";
import { meanEvidence,qualitativeFixture,reportFixture } from "./v3-fixtures";
import { mockTeamSynthesisV3 } from "@/server/team/report-v3-provider";
const ai=vi.hoisted(()=>({create:vi.fn()}));
vi.mock("openai",()=>({default:class {responses={create:ai.create};}}));
const job={id:"job",kind:"team_ai_report" as const,lease_token:"lease",attempts:1,pipeline_version:"TEAM-RU-3"};
const input=()=>qualitativeFixture();
function rpc(provider="mock",synthesis:unknown=null) {
  return vi.fn(async(name:string,args:Record<string,unknown>)=>{void args;return {data:name==="prepare_team_report_job"?{status:"generating",pipeline_version:"TEAM-RU-3",provider_mode:provider,qualitative_input:input(),report_input:meanEvidence(),synthesis}:name==="get_team_synthesis_privacy_corpus"?{threshold:32,answers:input().groups[0].texts.map(text=>({question_index:1,text})),identifiers:["Анна","private@example.test"]}:"completed",error:null};});
}
beforeEach(()=>{ai.create.mockReset();vi.spyOn(console,"info").mockImplementation(()=>{});});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("V3 worker evidence and call boundaries",()=>{
  it("mock coverage/synthesis/report completes with zero external calls",async()=>{
    vi.stubEnv("TEAM_AI_PROVIDER","mock");const db=rpc();expect(await processTeamJob(job,db)).toBe("completed");expect(ai.create).not.toHaveBeenCalled();expect(db.mock.calls.map(x=>x[0])).toContain("store_team_synthesis");expect(db.mock.calls.at(-1)?.[0]).toBe("publish_team_report");
  });
  it("real main report receives only separated means/safe synthesis, never raw answers/corpus",async()=>{
    vi.stubEnv("TEAM_AI_PROVIDER","openai");vi.stubEnv("OPENAI_API_KEY","synthetic-only");
    ai.create.mockResolvedValueOnce({status:"completed",output_text:JSON.stringify(mockTeamSynthesisV3(input()))}).mockResolvedValueOnce({status:"completed",output_text:JSON.stringify(reportFixture())});
    const db=rpc("openai");expect(await processTeamJob(job,db)).toBe("completed");expect(ai.create).toHaveBeenCalledTimes(2);
    const reportCall=ai.create.mock.calls[1][0],payload=reportCall.input[1].content;
    expect(payload).toContain("PRIMARY_CORE_EVIDENCE");expect(payload).toContain("TEAM_DYNAMICS_EVIDENCE");for(const raw of input().groups[0].texts)expect(payload).not.toContain(raw);
    expect(payload).not.toContain("private@example.test");expect(payload).not.toContain("privacy_corpus");expect(reportCall.store).toBe(false);
  });
  it("empty cached qualitative evidence stops before final AI and is nonretryable",async()=>{
    vi.stubEnv("TEAM_AI_PROVIDER","mock");const empty=Object.fromEntries(Object.keys(mockTeamSynthesisV3(input())).map(k=>[k,[]])),db=rpc("mock",empty);
    expect(await processTeamJob(job,db)).toBe("failed");expect(ai.create).not.toHaveBeenCalled();expect(db.mock.calls.at(-1)?.[1]).toMatchObject({p_error_code:"team_qualitative_insufficient",p_retryable:false});expect(db.mock.calls.map(x=>x[0])).not.toContain("publish_team_report");
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(input().groups[0].texts[0]);
  });
  it("provider mismatch fails closed before any model or corpus access",async()=>{
    vi.stubEnv("TEAM_AI_PROVIDER","mock");const db=rpc("openai");expect(await processTeamJob(job,db)).toBe("failed");expect(ai.create).not.toHaveBeenCalled();expect(db.mock.calls.at(-1)?.[1]).toMatchObject({p_error_code:"team_provider_mismatch",p_retryable:false});
  });
});
