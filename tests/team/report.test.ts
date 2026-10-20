import { afterEach, describe, expect, it, vi } from "vitest";
import { mainTeamReportInput } from "@/server/team/report-contracts";
import { generateTeamReport, synthesizeTeamTexts, teamAIProvider } from "@/server/team/report-provider";
import { orderDispersion } from "@/server/team/results";
import { processTeamJob, runTeamJobs } from "@/server/team/worker";
const input={participant_count:3,company_context:{company_name:"Синтетическая компания"},overall:{mean:50,stddev:10,min:25,max:75,maturity:"Зона развития"},blocks:[{title:"Процессы",position:1,mean:50,stddev:10,min:25,max:75}],questions:[{question:"Общий рабочий вопрос",mean:2,stddev:1}]};
const summary={themes:[],strengths:[],risks:[],alignment_signals:[],divergence_signals:[]};
const job={id:"job",kind:"team_ai_report" as const,lease_token:"lease",attempts:1};
afterEach(()=>vi.unstubAllEnvs());
describe("confidential Team report boundary",()=>{
 it("defaults Team provider to mock independently of legacy AI config",async()=>{
  vi.stubEnv("AI_REPORT_PROVIDER","openai");vi.stubEnv("TEAM_AI_PROVIDER",undefined);vi.stubEnv("OPENAI_API_KEY",undefined);
  expect(teamAIProvider().provider).toBe("mock");
  expect((await generateTeamReport(input,summary)).participant_count).toBe(3);
 });
 it.each(["participants","raw_answers","user_id","qualitative_groups"])("rejects main input field %s",field=>{
  expect(()=>mainTeamReportInput({...input,[field]:["private"]},summary)).toThrow();
 });
 it("rejects per-person nested numeric input and identities",()=>{
  expect(()=>mainTeamReportInput({...input,blocks:[{...input.blocks[0],participant_id:"private"}]},summary)).toThrow();
 });
 it("requires three non-empty text slots and strips nothing silently",async()=>{
  await expect(synthesizeTeamTexts([{question:"q",texts:["one","two"],response_count:2}])).rejects.toThrow();
  await expect(synthesizeTeamTexts([{question:"q",texts:["one","two","three"],response_count:3,participant_id:"private"}])).rejects.toThrow();
 });
 it("mock synthesis uses no copied respondent wording",async()=>{
  const unique="Do not copy this unique confidential wording anywhere";
  expect(JSON.stringify(await synthesizeTeamTexts([{question:"q",texts:[unique,unique,unique],response_count:3}]))).not.toContain(unique);
 });
 it("keeps main input anonymous and includes no qualitative source lists",()=>{
  const result=mainTeamReportInput(input,summary);
  expect(Object.keys(result).sort()).toEqual(["blocks","company_context","overall","participant_count","qualitative_summary","questions"]);
 });
 it("orders numeric dispersion then methodology position then ID in both directions",()=>{
  const base={participant_count:3,mean_score:2,stddev_score:1,min_score:0,max_score:4};
  const rows=[{...base,position:2,question_id:"z"},{...base,position:1,question_id:"b"},{...base,position:1,question_id:"a"}];
  expect(orderDispersion(rows).map(x=>x.question_id)).toEqual(["a","b","z"]);
  expect(orderDispersion(rows,true).map(x=>x.question_id)).toEqual(["a","b","z"]);
 });
 it("does not run Team queue against production or an unknown environment",async()=>{
  vi.stubEnv("APP_URL","https://audit.iteam.ru");expect(await runTeamJobs()).toBe(0);
 });
 it("validates/stores synthesis before generating and publishing main report",async()=>{
  const rpc=vi.fn(async(name:string)=>({data:name==="prepare_team_report_job"?{status:"generating",qualitative_groups:[],report_input:input}:"stored",error:null}));
  await processTeamJob(job,rpc);
  expect(rpc.mock.calls.map(c=>c[0])).toEqual(["prepare_team_report_job","store_team_synthesis","publish_team_report"]);
 });
 it("does not generate main report when the database privacy validator rejects synthesis",async()=>{
  const rpc=vi.fn(async(name:string)=>name==="prepare_team_report_job"?{data:{status:"generating",qualitative_groups:[],report_input:input},error:null}:name==="store_team_synthesis"?{data:null,error:{message:"team_privacy_rejected"}}:{data:null,error:null});
  await processTeamJob(job,rpc);
  expect(rpc.mock.calls.map(c=>c[0])).toEqual(["prepare_team_report_job","store_team_synthesis","fail_team_job"]);
 });
 it("retains only safe codes on provider failure, never raw error text",async()=>{
  const rpc=vi.fn(async(name:string)=>name==="prepare_team_report_job"?{data:null,error:{message:"503 secret raw text from provider"}}:{data:null,error:null});
  await processTeamJob(job,rpc);
  expect(JSON.stringify(rpc.mock.calls.at(-1))).not.toContain("secret raw");
  expect(rpc.mock.calls.at(-1)?.[0]).toBe("fail_team_job");
 });
 it("superseded or already-completed source causes no provider/publication work",async()=>{
  for(const status of ["superseded","completed"]){
   const rpc=vi.fn(async()=>({data:{status},error:null}));await processTeamJob(job,rpc);expect(rpc).toHaveBeenCalledOnce();
  }
 });
 it("aggregates internally without transferring individual values to the worker",async()=>{
  const rpc=vi.fn(async()=>({data:"completed",error:null}));await processTeamJob({...job,kind:"team_aggregate"},rpc);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("process_team_aggregate",{p_job_id:"job",p_lease_token:"lease"});
 });
});
