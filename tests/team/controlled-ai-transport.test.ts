import { describe,it,expect,vi } from 'vitest';
import { ControlledTeamAITransport,controlledTeamModel,controlledTeamStageTokens,type ControlledTeamClaim,type ControlledTeamRpc,type ControlledTeamStage } from '@/server/team/controlled-ai-transport';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const server=Date.parse('2026-10-23T18:00:00Z');
const claim:ControlledTeamClaim={run_id:id(1),team_id:id(2),report_id:id(3),source_fingerprint:'a'.repeat(64),job_id:id(4),kind:'team_ai_report',lease_token:id(5),lease_expires_at:new Date(server+600000).toISOString(),deadline_at:new Date(server+540000).toISOString(),server_now:new Date(server).toISOString(),pipeline_version:'TEAM-RU-3',provider_mode:'openai',attempts:1};
const body=(stage:Exclude<ControlledTeamStage,'model_get'>,extra:Record<string,unknown>={})=>({model:controlledTeamModel,store:false,max_output_tokens:controlledTeamStageTokens[stage],input:[{role:'user',content:'Synthetic evidence only'}],text:{format:{type:'json_schema',strict:true,schema:{type:'object',properties:{},additionalProperties:false}}},...extra});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const response=(tokens=10)=>({id:'resp_synthetic',status:'completed',model:controlledTeamModel,usage:{input_tokens:1,output_tokens:tokens},output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]});
function harness(){
  let clock=0,ordinal=10;const spent=new Set<string>(),completed:Record<string,unknown>[]=[],calls:{url:string;init:RequestInit}[]=[];
  const rpc=vi.fn<ControlledTeamRpc>(async(name,args)=>{
    if(name==='reserve_controlled_team_ai_call'){
      const key=String(args.p_stage);if(spent.has(key))return{data:null,error:{message:'spent'}};spent.add(key);
      return{data:{...claim,server_now:new Date(server+clock).toISOString(),reservation_id:id(ordinal++),stage:key,model:controlledTeamModel},error:null};
    }
    if(name==='complete_controlled_team_effect'){completed.push(args);return{data:{status:args.p_status},error:null};}
    throw Error('unexpected fake RPC');
  });
  const fetch=vi.fn<typeof globalThis.fetch>(async(input,init)=>{calls.push({url:String(input),init:init??{}});return String(input).includes('/models/')?json({id:controlledTeamModel}):json(response());});
  const make=(overrides:Partial<ConstructorParameters<typeof ControlledTeamAITransport>[0]>={})=>new ControlledTeamAITransport({claim,rpc,fetch,apiKey:'synthetic-not-a-real-key',monotonic:()=>clock,...overrides});
  return{rpc,fetch,calls,spent,completed,make,advance:(ms:number)=>{clock+=ms;}};
}

describe('controlled Team durable transport',()=>{
  it('reserves before exact HTTP dispatch, caps all stages and records safe receipts only',async()=>{
    const h=harness(),t=h.make();await t.preflightModel();
    for(const stage of ['synthesis','synthesis_repair','main_report','report_repair'] as const)expect((await t.create(stage,body(stage))).output_text).toBe('{"ok":true}');
    expect(h.calls).toHaveLength(5);expect(h.spent.size).toBe(5);expect(h.completed).toHaveLength(5);
    expect(t.safeAudit()).toMatchObject({modelHTTPStarted:1,responsesHTTPStarted:4,automaticRetries:0});
    for(const call of h.calls){expect(call.init.redirect).toBe('error');expect(call.url).toMatch(/^https:\/\/api\.openai\.com\/v1\/(models\/gpt-5\.6-sol|responses)$/);}
    expect(h.calls.slice(1).map(x=>JSON.parse(x.init.body as string).max_output_tokens)).toEqual([6000,6000,14000,6000]);
    expect(h.calls.slice(1).reduce((sum,x)=>sum+JSON.parse(x.init.body as string).max_output_tokens,0)).toBe(32000);
    expect(JSON.stringify(t.safeAudit())).not.toMatch(/Synthetic evidence|synthetic-not-a-real-key|Authorization/);
    await expect(t.create('synthesis',body('synthesis'))).rejects.toThrow('controlled_team_ai_rejected');expect(h.calls).toHaveLength(5);
  });
  it('two processes and restart cannot reset the same durable GET reservation',async()=>{
    const h=harness();await h.make().preflightModel();const restarted=h.make();await expect(restarted.preflightModel()).rejects.toThrow();expect(h.calls).toHaveLength(1);
    expect(restarted.safeAudit()).toMatchObject({attemptedStages:['model_get'],reservedStages:[]});
  });
  it('never sends Responses before model admission or a stage with mismatched contract',async()=>{
    const h=harness(),t=h.make();await expect(t.create('synthesis',body('synthesis'))).rejects.toThrow();expect(h.calls).toHaveLength(0);
    await t.preflightModel();
    for(const extra of [{model:'substitute'},{store:true},{max_output_tokens:16000},{background:true},{text:{format:{type:'json_object'}}},{input:[{content:'🌍'.repeat(40000)}]}])await expect(t.create('synthesis',body('synthesis',extra))).rejects.toThrow();
    expect(h.calls).toHaveLength(1);expect(h.spent).toEqual(new Set(['model_get']));
  });
  it.each([401,429,503,302])('HTTP %i burns one attempt and makes no automatic retry',async status=>{
    const h=harness();h.fetch.mockImplementation(async(input,init)=>{h.calls.push({url:String(input),init:init??{}});return json({error:'do not persist provider body'},status);});
    const t=h.make();await expect(t.preflightModel()).rejects.toThrow('controlled_team_provider_failed');expect(h.calls).toHaveLength(1);expect(h.completed[0]).toMatchObject({p_status:'failed',p_metadata:{http_status:status}});expect(JSON.stringify(h.completed)).not.toContain('do not persist');
  });
  it('unknown network result remains spent across processes without raw exception details',async()=>{
    const h=harness();h.fetch.mockRejectedValue(Error('secret provider exception'));const t=h.make();await expect(t.preflightModel()).rejects.toThrow('controlled_team_provider_unknown');expect(h.fetch).toHaveBeenCalledOnce();expect(h.completed[0]).toMatchObject({p_status:'unknown'});await expect(h.make().preflightModel()).rejects.toThrow();expect(h.fetch).toHaveBeenCalledOnce();expect(JSON.stringify(t.safeAudit())).not.toContain('secret provider');
  });
  it('does not dispatch on foreign reservation, late reservation or already-aborted shutdown',async()=>{
    const h=harness(),foreign=vi.fn<ControlledTeamRpc>(async()=>({data:{...claim,reservation_id:id(99),stage:'model_get',model:controlledTeamModel,team_id:id(77)},error:null}));
    await expect(h.make({rpc:foreign}).preflightModel()).rejects.toThrow();expect(h.fetch).not.toHaveBeenCalled();
    const late=harness();const rpc:ControlledTeamRpc=async(name,args)=>{const result=await late.rpc(name,args);if(name==='reserve_controlled_team_ai_call')late.advance(539000);return result;};
    await expect(late.make({rpc}).preflightModel()).rejects.toThrow();expect(late.fetch).not.toHaveBeenCalled();
    const controller=new AbortController();controller.abort();await expect(h.make({signal:controller.signal}).preflightModel()).rejects.toThrow();expect(h.fetch).not.toHaveBeenCalled();
  });
  it('cannot extend the initial persisted deadline when later reservation timestamps change',async()=>{
    const h=harness(),t=h.make();await t.preflightModel();h.advance(530000);await expect(t.create('synthesis',body('synthesis'))).rejects.toThrow();expect(h.calls).toHaveLength(1);
    expect(()=>h.make({claim:{...claim,deadline_at:new Date(server+541000).toISOString()}})).toThrow();
  });
  it('caps each call by remaining run time and propagates active shutdown to fetch',async()=>{
    const h=harness(),controller=new AbortController();const t=h.make({signal:controller.signal});await t.preflightModel();
    h.fetch.mockImplementation(async(_input,init)=>new Promise((_resolve,reject)=>{const signal=init?.signal;signal?.addEventListener('abort',()=>reject(Error('stop')),{once:true});controller.abort();}));
    await expect(t.create('main_report',body('main_report'))).rejects.toThrow('controlled_team_provider_unknown');expect(h.fetch).toHaveBeenCalledTimes(2);expect(h.completed.at(-1)).toMatchObject({p_status:'unknown'});
  });
  it('rejects incomplete/wrong-model/over-limit receipts without another provider call',async()=>{
    for(const invalid of [{...response(),status:'incomplete'},{...response(),model:'other'},response(14001)]){
      const h=harness(),t=h.make();await t.preflightModel();h.fetch.mockResolvedValue(json(invalid));await expect(t.create('main_report',body('main_report'))).rejects.toThrow('controlled_team_output_rejected');expect(h.fetch).toHaveBeenCalledTimes(2);expect(h.completed.at(-1)).toMatchObject({p_status:'failed'});
    }
  });
  it('does not report success if durable completion fails',async()=>{
    const h=harness(),rpc:ControlledTeamRpc=async(name,args)=>name==='complete_controlled_team_effect'?{data:null,error:{message:'unknown DB outcome'}}:h.rpc(name,args);
    await expect(h.make({rpc}).preflightModel()).rejects.toThrow('controlled_team_receipt_unconfirmed');expect(h.fetch).toHaveBeenCalledOnce();expect(h.spent.size).toBe(1);
  });
  it('records a succeeded receipt but rejects its output when receipt persistence crosses the deadline', async () => {
    const h = harness();
    const rpc: ControlledTeamRpc = async (name, args) => {
      const result = await h.rpc(name, args);
      if (name === 'complete_controlled_team_effect') h.advance(539000);
      return result;
    };
    const transport = h.make({ rpc });
    await expect(transport.preflightModel()).rejects.toThrow('controlled_team_ai_rejected');
    expect(transport.safeAudit()).toMatchObject({
      modelHTTPStarted: 1,
      responsesHTTPStarted: 0,
      receipts: [{ stage: 'model_get', status: 'succeeded' }],
    });
    await expect(transport.create('synthesis', body('synthesis'))).rejects.toThrow();
    expect(h.fetch).toHaveBeenCalledOnce();
  });
});
