import { beforeEach,it,expect,vi } from "vitest";
import { cardsSchema } from "@/server/team/quality/contracts";
const state=vi.hoisted(()=>({construct:vi.fn(),create:vi.fn()}));
vi.mock("openai",()=>({default:class {constructor(options:unknown){state.construct(options);}responses={create:state.create};}}));
import { createApprovedPort } from "@/server/team/quality/openai-port";
import { runQualityVariant,type Stage } from "@/server/team/quality/runtime";
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
