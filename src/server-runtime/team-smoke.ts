// Node-safe shared boundary. Importing this module does not read credentials or
// open a connection; ordinary worker entry points can use the pure environment check.
import {z} from 'zod';
import {createAdminClient} from '@/server-runtime/supabase/admin';

type Env=Record<string,string|undefined>;
const productionOrigin='https://audit.iteam.ru';
const productionDatabase='https://fhvxqeaujjeiflanqsbg.supabase.co';
/** Every production Team mutation/effect requires the DB-controlled run. */
export function controlledTeamRequired(env:Env=process.env){
 if(env.APP_URL!==productionOrigin && env.SUPABASE_URL!==productionDatabase)return false;
 if(env.NODE_ENV!=='production'||env.APP_URL!==productionOrigin||env.SUPABASE_URL!==productionDatabase)throw Error('controlled_team_unavailable');
 return true;
}

const optionalWindow={window_id:z.uuid().nullable().optional(),continuation_window_id:z.uuid().nullable().optional()};
const contextSchema=z.object({mode:z.literal('controlled'),run_id:z.uuid(),owner_user_id:z.uuid(),account_id:z.uuid(),company_id:z.uuid(),team_id:z.uuid().nullable(),participant_id:z.uuid().nullable(),expires_at:z.iso.datetime({offset:true}),server_now:z.iso.datetime({offset:true}),...optionalWindow,personal_deadline_at:z.iso.datetime({offset:true}).nullable().optional(),approved_plan_hash:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional()}).refine(c=>!c.continuation_window_id||c.window_id===c.continuation_window_id);
export type ControlledTeamContext=z.infer<typeof contextSchema>;
export type ControlledTeamTarget={companyId?:string;teamId?:string;participantId?:string;invitationHash?:string;ownerUserId?:string;windowId?:string};
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message?:string}|null}>;
const monotonicDeadlines=new WeakMap<object,number>();
const personalDeadlines=new WeakMap<object,number>();
function rememberDeadline(value:object,serverNow:string,expires:string,requestStarted:number){
 const remaining=Date.parse(expires)-Date.parse(serverNow)-(performance.now()-requestStarted);
 if(!Number.isFinite(remaining)||remaining<=0||remaining>60*60*1000)throw Error('controlled_team_unavailable');
 monotonicDeadlines.set(value,performance.now()+remaining);
}
/** DB-relative expiry minus the full RPC round trip, then monotonic elapsed time.
 * A wall-clock rollback or a slow client cannot extend the approved DB window. */
export function controlledTeamMillisecondsRemaining(value:ControlledTeamContext|ControlledTeamEffect){
 const deadline=monotonicDeadlines.get(value);
 if(deadline===undefined){
  if(controlledTeamRequired())throw Error('controlled_team_unavailable');
  return Date.parse('deadline_at' in value?value.deadline_at:value.expires_at)-Date.now();
 }
 return Math.min(deadline-performance.now(),Date.parse('deadline_at' in value?value.deadline_at:value.expires_at)-Date.now());
}
export function controlledTeamPersonalMillisecondsRemaining(context:ControlledTeamContext){
 if(!context.personal_deadline_at)return 0;
 const wall=Date.parse(context.personal_deadline_at)-Date.now(),monotonic=personalDeadlines.get(context);
 if(monotonic===undefined){if(controlledTeamRequired())throw Error('controlled_team_unavailable');return wall;}
 return Math.min(wall,monotonic-performance.now());
}
const rpc=async(name:string,args:Record<string,unknown>)=>{
 const client=createAdminClient() as unknown as {rpc:Rpc};
 const {data,error}=await client.rpc(name,args);
 if(error)throw Error('controlled_team_unavailable');
 return data;
};
export function assertControlledTeamWindow(context:ControlledTeamContext,now=Date.now()){
 const expires=Date.parse(context.expires_at),server=Date.parse(context.server_now);
 if(!Number.isFinite(expires)||!Number.isFinite(server)||expires<=server||expires<=now||expires-server>60*60*1000||controlledTeamMillisecondsRemaining(context)<=0)throw Error('controlled_team_unavailable');
}
export async function controlledTeamContext(target:ControlledTeamTarget):Promise<ControlledTeamContext|null>{
 if(!controlledTeamRequired())return null;
 for(const id of [target.companyId,target.teamId,target.participantId,target.ownerUserId,target.windowId])if(id!==undefined&&!z.uuid().safeParse(id).success)throw Error('controlled_team_unavailable');
 if(target.invitationHash!==undefined&&!/^[a-f0-9]{64}$/.test(target.invitationHash))throw Error('controlled_team_unavailable');
 if(!target.companyId&&!target.teamId&&!target.participantId&&!target.invitationHash)throw Error('controlled_team_unavailable');
 let context:ControlledTeamContext;
 const started=performance.now();
 try {context=contextSchema.parse(await rpc('controlled_team_context',{p_company_id:target.companyId??null,p_team_id:target.teamId??null,p_participant_id:target.participantId??null,p_invitation_hash:target.invitationHash??null}));}
 catch {throw Error('controlled_team_unavailable');}
 rememberDeadline(context,context.server_now,context.expires_at,started);
 assertControlledTeamWindow(context);
 if(target.ownerUserId&&context.owner_user_id!==target.ownerUserId||target.companyId&&context.company_id!==target.companyId||target.teamId&&context.team_id!==target.teamId||target.participantId&&context.participant_id!==target.participantId||target.windowId&&context.window_id!==target.windowId)throw Error('controlled_team_unavailable');
 if(context.window_id&&(!context.personal_deadline_at||Date.parse(context.personal_deadline_at)>Date.parse(context.expires_at)))throw Error('controlled_team_unavailable');
 if(context.window_id&&context.personal_deadline_at)personalDeadlines.set(context,performance.now()+Date.parse(context.personal_deadline_at)-Date.parse(context.server_now)-(performance.now()-started));
 return context;
}

const reservationSchema=z.object({reservation_id:z.uuid(),run_id:z.uuid(),deadline_at:z.iso.datetime({offset:true}),server_now:z.iso.datetime({offset:true}),team_id:z.uuid(),participant_id:z.uuid().nullable(),report_id:z.uuid().nullable(),recipient_email:z.email().nullable(),invitation_hash:z.string().regex(/^[a-f0-9]{64}$/).nullable(),...optionalWindow});
export type ControlledTeamEffect=z.infer<typeof reservationSchema>;
export async function reserveControlledTeamEffect(context:ControlledTeamContext|null,effect:'auth_link'|'invitation_email'|'pdf',binding:{participantId?:string;reportId?:string}):Promise<ControlledTeamEffect|null>{
 if(!context){if(controlledTeamRequired())throw Error('controlled_team_unavailable');return null;}
 assertControlledTeamWindow(context);
 if(!context.team_id||(effect==='pdf'?!binding.reportId:!binding.participantId))throw Error('controlled_team_unavailable');
 if(context.window_id&&effect!=='pdf')throw Error('controlled_team_unavailable');
 let reserved:ControlledTeamEffect;
 const started=performance.now();
 try{reserved=reservationSchema.parse(await rpc(context.window_id?'reserve_controlled_team_window_effect':'reserve_controlled_team_effect',{...(context.window_id?{p_run_id:context.run_id,p_window_id:context.window_id}:{}),p_team_id:context.team_id,p_effect:effect,p_participant_id:binding.participantId??null,p_report_id:binding.reportId??null}));}
 catch{throw Error('controlled_team_budget_consumed');}
 rememberDeadline(reserved,reserved.server_now,reserved.deadline_at,started);
 const contextDeadline=monotonicDeadlines.get(context);
 if(contextDeadline!==undefined)monotonicDeadlines.set(reserved,Math.min(monotonicDeadlines.get(reserved)!,contextDeadline));
 if(reserved.run_id!==context.run_id||reserved.team_id!==context.team_id||(reserved.window_id??null)!==(context.window_id??null)||reserved.participant_id!==(binding.participantId??null)||reserved.report_id!==(binding.reportId??null)||Date.parse(reserved.deadline_at)>Date.parse(context.expires_at)||Date.parse(reserved.deadline_at)<=Date.parse(reserved.server_now)||Date.parse(reserved.deadline_at)<=Date.now())throw Error('controlled_team_unavailable');
 if(effect==='pdf'?(reserved.recipient_email!==null||reserved.invitation_hash!==null):(!reserved.recipient_email||!reserved.invitation_hash))throw Error('controlled_team_unavailable');
 return reserved;
}
export function assertControlledTeamEffectWindow(effect:ControlledTeamEffect|null){
 if(!effect){if(controlledTeamRequired())throw Error('controlled_team_unavailable');return;}
 const remaining=controlledTeamMillisecondsRemaining(effect);
 if(!Number.isFinite(remaining)||remaining<=0)throw Error('controlled_team_unavailable');
}
/** Completion only records the outcome. It never releases or resets a reservation. */
export async function completeControlledTeamEffect(effect:ControlledTeamEffect|null,status:'succeeded'|'failed'|'unknown',providerReference:string|null=null){
 if(!effect)return;
 const result=await rpc('complete_controlled_team_effect',{p_reservation_id:effect.reservation_id,p_status:status,p_provider_reference:providerReference});
 if(!result||typeof result!=='object'||(result as {status?:unknown}).status!==status)throw Error('controlled_team_effect_unconfirmed');
}

const accessSchema=reservationSchema.extend({window_id:z.uuid(),participant_id:z.uuid(),recipient_email:z.email(),invitation_hash:z.string().regex(/^[a-f0-9]{64}$/),user_id:z.uuid(),display_name:z.string().min(1).max(100),create_user:z.literal(false)});
export type ControlledTeamW2Access=z.infer<typeof accessSchema>;
/** The separate W2 slots never reuse historical auth_link/invitation_email rows. */
export async function reserveControlledTeamW2Access(context:ControlledTeamContext,participantId:string,effect:'reauth_link'|'access_email'):Promise<ControlledTeamW2Access>{
 assertControlledTeamWindow(context);
 if(!context.window_id||!context.team_id||context.participant_id!==participantId||!context.personal_deadline_at||controlledTeamPersonalMillisecondsRemaining(context)<=0)throw Error('controlled_team_unavailable');
 const started=performance.now();let result:ControlledTeamW2Access;
 try{result=accessSchema.parse(await rpc('reserve_controlled_team_w2_access',{p_window_id:context.window_id,p_participant_id:participantId,p_effect:effect}));}
 catch{throw Error('controlled_team_budget_consumed');}
 rememberDeadline(result,result.server_now,result.deadline_at,started);
 const parentDeadline=monotonicDeadlines.get(context);
 if(parentDeadline!==undefined)monotonicDeadlines.set(result,Math.min(monotonicDeadlines.get(result)!,parentDeadline));
 if(result.run_id!==context.run_id||result.window_id!==context.window_id||result.team_id!==context.team_id||result.participant_id!==participantId||result.report_id!==null||Date.parse(result.deadline_at)>Date.parse(context.personal_deadline_at))throw Error('controlled_team_unavailable');
 assertControlledTeamEffectWindow(result);return result;
}
const verificationSchema=z.object({verification_id:z.uuid(),run_id:z.uuid(),window_id:z.uuid(),participant_id:z.uuid(),user_id:z.uuid(),invitation_hash:z.string().regex(/^[a-f0-9]{64}$/)});
export type ControlledTeamW2Verification=z.infer<typeof verificationSchema>;
/** Called only at the genuine current-consent action, never while preparing a link. */
export async function reserveControlledTeamW2Verification(context:ControlledTeamContext,binding:{participantId:string;userId:string;invitationHash:string}):Promise<ControlledTeamW2Verification>{
 assertControlledTeamWindow(context);
 if(!context.window_id||context.participant_id!==binding.participantId||!context.personal_deadline_at||controlledTeamPersonalMillisecondsRemaining(context)<=0)throw Error('controlled_team_unavailable');
 let verification:ControlledTeamW2Verification;
 try{verification=verificationSchema.parse(await rpc('reserve_controlled_team_w2_verification',{p_window_id:context.window_id,p_participant_id:binding.participantId,p_invitation_hash:binding.invitationHash}));}
 catch{throw Error('controlled_team_budget_consumed');}
 if(verification.run_id!==context.run_id||verification.window_id!==context.window_id||verification.participant_id!==binding.participantId||verification.user_id!==binding.userId||verification.invitation_hash!==binding.invitationHash)throw Error('controlled_team_unavailable');
 return verification;
}
