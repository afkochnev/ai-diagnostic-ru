import OpenAI from "openai";
import { z } from "zod";
import { stagePrompt } from "./prompts";
import type { StagePort,StageRequest } from "./runtime";
import { QualityBudgetError,type RequestByteCaps } from "./request-budget";

/** Shared by the offline serialization check and the real transport. No client or I/O. */
export function approvedRequestBody(request:StageRequest,model:"gpt-5.6-sol",effort:"medium") {
  const tag=request.stage.startsWith("baseline_")?"UNTRUSTED_TEAM_EVIDENCE":"UNTRUSTED_EVIDENCE";
  return {model,reasoning:{effort},store:false as const,max_output_tokens:request.maxOutputTokens,
    input:[{role:"system" as const,content:stagePrompt(request.stage,request.privacyPolicy,request.editorialSystemText)},{role:"user" as const,content:`<${tag}>\n${JSON.stringify(request.input)}\n</${tag}>`}],
    text:{format:{type:"json_schema" as const,name:`team_quality_${request.stage}`,strict:true as const,schema:z.toJSONSchema(request.schema,{reused:"ref"})}}};
}

export type CallReceipt={stage:string;requestId:string|null;model:string;effort:"medium";elapsedMs:number;inputTokens:number;outputTokens:number;reservedUSD:number};
/** Only constructed by an explicitly approved comparison controller. No environment fallback. */
export function createApprovedPort(config:{apiKey:string;approved:boolean;model:"gpt-5.6-sol";effort:"medium";maxCalls:number;maxUSD:number;deadline:number;requestByteCaps?:RequestByteCaps;attempt:(r:{stage:string;ordinal:number;reservedUSD:number})=>void;receipt:(r:CallReceipt)=>void}):StagePort {
  if(!config.approved||!config.apiKey||config.maxCalls<1||config.maxUSD<=0)throw new Error("quality_approval_required");
  let calls=0,reserved=0;
  const client=new OpenAI({apiKey:config.apiKey,baseURL:"https://api.openai.com/v1",maxRetries:0,timeout:180000,fetch:(input,init)=>fetch(input,{...init,redirect:"error"})});
  return async request=>{
    const body=approvedRequestBody(request,config.model,config.effort);
    const bytes=Buffer.byteLength(JSON.stringify(body)),limit=config.requestByteCaps?.[request.stage]??120000;
    // Conservative liability reservation: <=1 input token/UTF8 byte, $5/M input
    // (includes 1.25x cache-write premium), $20/M output; no cached discount assumed.
    const liability=bytes*5/1e6+request.maxOutputTokens*20/1e6;
    if(bytes>limit)throw new QualityBudgetError("request_size",request.stage,bytes,limit);
    if(calls>=config.maxCalls)throw new QualityBudgetError("call_limit",request.stage,bytes,limit);
    if(reserved+liability>config.maxUSD+1e-8)throw new QualityBudgetError("cost_limit",request.stage,bytes,limit);
    if(Math.min(config.deadline,request.deadline)-Date.now()<185000)throw new QualityBudgetError("deadline",request.stage,bytes,limit);
    calls++;reserved+=liability;config.attempt({stage:request.stage,ordinal:calls,reservedUSD:liability});const start=Date.now();
    const response=await client.responses.create(body);
    config.receipt({stage:request.stage,requestId:response._request_id??null,model:response.model,effort:config.effort,elapsedMs:Date.now()-start,
      inputTokens:response.usage?.input_tokens??0,outputTokens:response.usage?.output_tokens??0,reservedUSD:liability});
    if(response.model!==config.model||response.status!=="completed"||!response.output_text)throw new Error("quality_stage_failed");
    if((response.usage?.input_tokens??0)>bytes||(response.usage?.output_tokens??0)>request.maxOutputTokens)throw new QualityBudgetError("usage_limit",request.stage,bytes,limit);
    return JSON.parse(response.output_text);
  };
}
