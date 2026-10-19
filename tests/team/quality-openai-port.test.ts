import { beforeEach,it,expect,vi } from "vitest";
import { cardsSchema } from "@/server/team/quality/contracts";
const state=vi.hoisted(()=>({construct:vi.fn(),create:vi.fn()}));
vi.mock("openai",()=>({default:class {constructor(options:unknown){state.construct(options);}responses={create:state.create};}}));
import { createApprovedPort,approvedRequestBody } from "@/server/team/quality/openai-port";
import { runQualityVariant,stageTokens,type Stage } from "@/server/team/quality/runtime";
import { foodtechRequestByteCaps,QualityBudgetError } from "@/server/team/quality/request-budget";
import { qualityCase,caseIds } from "../../scripts/fixtures/team-quality-cases";
import { authoredStageStubs } from "../../scripts/fixtures/team-quality-stage-stubs";
const request=()=>({stage:"extract" as const,input:{groups:[]},schema:cardsSchema,maxOutputTokens:4000,deadline:Date.now()+600000});
function setup(overrides:Record<string,unknown>={}){const receipt=vi.fn(),attempt=vi.fn();return {receipt,attempt,port:()=>createApprovedPort({apiKey:"synthetic-only-key",approved:true,model:"gpt-5.6-sol",effort:"medium",maxCalls:1,maxUSD:1,deadline:Date.now()+600000,receipt,attempt,...overrides})};}
beforeEach(()=>{vi.clearAllMocks();state.create.mockResolvedValue({status:"completed",model:"gpt-5.6-sol",output_text:'{"cards":[],"omitted_groups":[],"limitations":[]}',usage:{input_tokens:100,output_tokens:30},_request_id:"safe-receipt"});});
it("requires explicit approval before constructing any API client",()=>{expect(()=>setup({approved:false}).port()).toThrow("quality_approval_required");expect(state.construct).not.toHaveBeenCalled();});
it("pins endpoint/model/effort, disables storage/retry and emits metadata only",async()=>{
 const s=setup(),port=s.port();await port(request());const body=state.create.mock.calls[0][0];expect(body).toMatchObject({model:"gpt-5.6-sol",reasoning:{effort:"medium"},store:false,max_output_tokens:4000});
 expect(state.construct.mock.calls[0][0]).toMatchObject({baseURL:"https://api.openai.com/v1",maxRetries:0,timeout:180000});expect(body.text.format.strict).toBe(true);
 expect(s.attempt).toHaveBeenCalledTimes(1);expect(s.receipt).toHaveBeenCalledTimes(1);expect(JSON.stringify(s.receipt.mock.calls)).not.toContain("synthetic-only-key");expect(JSON.stringify(s.attempt.mock.calls)).not.toContain("groups");
 await expect(port(request())).rejects.toThrow("quality_budget_exhausted");expect(state.create).toHaveBeenCalledTimes(1);
});
it("reserves costs and rejects excess input/deadline before a request is sent",async()=>{
 for(const s of [setup({maxUSD:0.000001}),setup({deadline:Date.now()+100})])await expect(s.port()(request())).rejects.toThrow("quality_budget_exhausted");
 await expect(setup().port()({...request(),input:{text:"x".repeat(120001)}})).rejects.toThrow("quality_budget_exhausted");expect(state.create).not.toHaveBeenCalled();
});
it("records an attempted network call even if its response is lost and never retries",async()=>{
 state.create.mockRejectedValueOnce(new Error("network"));const s=setup();await expect(s.port()(request())).rejects.toThrow("network");expect(s.attempt).toHaveBeenCalledTimes(1);expect(s.receipt).not.toHaveBeenCalled();expect(state.create).toHaveBeenCalledTimes(1);
});
it("checks the same serialized body offline and applies explicit stage caps without changing evidence",async()=>{
 const r={...request(),stage:"baseline_report" as const,input:{text:"x".repeat(125000)}};
 const offline=approvedRequestBody(r,"gpt-5.6-sol","medium");expect(state.construct).not.toHaveBeenCalled();
 expect(Buffer.byteLength(JSON.stringify(offline))).toBeGreaterThan(120000);
 await expect(setup().port()(r)).rejects.toMatchObject({reason:"request_size",stage:"baseline_report",byteLimit:120000});
 const s=setup({maxUSD:2,requestByteCaps:foodtechRequestByteCaps});await s.port()(r);
 expect(state.create).toHaveBeenCalledTimes(1);expect(state.create.mock.calls[0][0]).toEqual(offline);
 await expect(setup({requestByteCaps:foodtechRequestByteCaps}).port()({...r,stage:"extract"})).rejects.toBeInstanceOf(QualityBudgetError);
 expect(state.create).toHaveBeenCalledTimes(1);
});
it("keeps the cumulative retry reservation below the original approved cost and request ceiling",()=>{
 const stages:Stage[]=["baseline_synthesis","baseline_report","review","extract","combined","review","extract","diagnose","program","core","dynamics","review"];
 const normalInput=stages.reduce((n,s)=>n+foodtechRequestByteCaps[s],0),normalOutput=stages.reduce((n,s)=>n+stageTokens[s],0);
 expect(normalInput).toBe(1512000);expect(normalOutput).toBe(81000);
 const maxNew=(normalInput+5*foodtechRequestByteCaps.privacy_repair)*5/1e6+(normalOutput+5*stageTokens.privacy_repair)*20/1e6;
 expect(maxNew).toBeCloseTo(12.48,8);expect(maxNew+0.22204).toBeLessThan(13.14);expect(stages.length+5+1).toBe(18);
 const bc=stages.slice(3),bcMax=(bc.reduce((n,s)=>n+foodtechRequestByteCaps[s],0)+3*foodtechRequestByteCaps.privacy_repair)*5/1e6+(bc.reduce((n,s)=>n+stageTokens[s],0)+3*stageTokens.privacy_repair)*20/1e6;
 expect(bcMax).toBeCloseTo(8.62,8);expect(bcMax+2.63549).toBeLessThan(13.14);expect(bc.length+3+6).toBe(18);
});
it("keeps a payload-free budget reason through the runtime's stage boundary",async()=>{
 const f=qualityCase("production"),error=new QualityBudgetError("request_size","baseline_synthesis",130000,120000);
 await expect(runQualityVariant({...f,variant:"A",maxCalls:5,deadline:Date.now()+600000,databaseValidate:async()=>{},call:async()=>{throw error;}})).rejects.toBe(error);
 expect(error.safeDetails()).toEqual({reason:"request_size",stage:"baseline_synthesis",requestBytes:130000,maximumRequestBytes:120000});
});
it("preserves the original A prompt delimiter and rejects a substituted model",async()=>{
 const s=setup();state.create.mockResolvedValueOnce({status:"completed",model:"other",output_text:"{}"});await expect(s.port()({...request(),stage:"baseline_synthesis"})).rejects.toThrow("quality_stage_failed");
 expect(state.create.mock.calls[0][0].input[1].content).toContain("<UNTRUSTED_TEAM_EVIDENCE>");
});
it.each(caseIds)("serializes all B/C stages within approved schema/request bounds for %s without external calls",async id=>{
 const f=qualityCase(id),stubs=authoredStageStubs(f);
 state.create.mockImplementation(async body=>({status:"completed",model:"gpt-5.6-sol",output_text:JSON.stringify(stubs[body.text.format.name.replace("team_quality_","") as Stage]),usage:{input_tokens:100,output_tokens:30}}));
 for(const variant of ["B","C"] as const){
  const port=setup({maxCalls:8,maxUSD:5}).port();
  await runQualityVariant({...f,variant,maxCalls:8,deadline:Date.now()+600000,databaseValidate:async()=>{},call:port});
 }
 for(const [body] of state.create.mock.calls){
  expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(120000);
  let enums=0;const scan=(v:unknown)=>{if(v&&typeof v==="object"){if("enum" in v)enums+=(v as {enum:unknown[]}).enum.length;for(const child of Object.values(v))scan(child);}};
  scan(body.text.format.schema);expect(enums).toBeLessThanOrEqual(1000);
  if(["team_quality_core","team_quality_combined"].includes(body.text.format.name)){
   const schema=body.text.format.schema,deref=(v:Record<string,unknown>):Record<string,unknown>=>typeof v.$ref==="string"?v.$ref.split("/").slice(1).reduce((o,k)=>o[k],schema):v;
   const paragraph=deref(schema.properties.content.properties.summary),refs=deref((paragraph.properties as Record<string,Record<string,unknown>>).refs);
   expect(deref(refs.items as Record<string,unknown>).enum).toContain("overall.mean");
   expect(body.text.format.schema.properties).not.toHaveProperty("support");
  }
 }
});
