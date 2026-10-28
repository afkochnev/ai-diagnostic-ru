// Staging acceptance only. Inert import, finite read-only RPCs, no W2 mutation.
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {assertEvidenceChannelContext,evidenceChannelHeader,evidenceChannelMAC,evidenceKeyContext,type EvidenceChannelKey,type EvidenceKeyContext} from '@/server/team/evidence-channel-key';
import {acceptedStageCaptureFingerprint,validateAcceptedStageSnapshot} from '../../scripts/operator-w2/preservation';

export const STAGING_EVIDENCE_PROJECT='vflgxgdwlftlyjslyrmo' as const;
export const EVIDENCE_ROOT='e3623f1d-2da0-4dfe-b600-d747f529c5fc' as const;
const participant='0ae17418-e97a-46c7-9000-c13580f72506',user='b7cc06c7-056c-4fd8-b445-eeaf187cec7c';
const fail=()=>Error('staging_evidence_readonly_unavailable_STOP');
const capabilitySchema=z.strictObject({matched:z.literal(true),run_id:z.literal(EVIDENCE_ROOT),window_id:z.null(),participant_id:z.literal(participant),user_id:z.literal(user),operation:z.literal('capability'),reservation_id:z.null(),server_now:z.iso.datetime({offset:true}),approved_plan_hash:z.null()});
async function boundedJSON(response:Response,maximum:number,signal:AbortSignal){
 const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maximum))throw fail();
 const reader=response.body?.getReader();if(!reader)throw fail();let size=0;const chunks:Uint8Array[]=[];
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{for(;;){const r=await reader.read();if(signal.aborted)throw fail();if(r.done)break;size+=r.value.byteLength;if(size>maximum)throw fail();chunks.push(r.value);}return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks,size)));}
 catch{abort();throw fail();}finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
}
/** Caller must durably own both finite attempts before dispatch. The opaque key
 * is used only for MACs and a transient HTTPS header; never returned as evidence. */
export function createStagingReadonlyEvidenceClient(options:{context:EvidenceKeyContext;key:EvidenceChannelKey;serviceRole:string;fetch:typeof fetch}){
 const context=evidenceKeyContext(options.context);
 assertEvidenceChannelContext(options.key,context);
 if(context.rootRunId!==EVIDENCE_ROOT||typeof options.serviceRole!=='string'||!/^[A-Za-z0-9._-]{20,4096}$/.test(options.serviceRole)||typeof options.fetch!=='function')throw fail();
 const {key,serviceRole,fetch:fetchImpl}=options;let capabilitySpent=false,captureSpent=false;
 async function request(name:'check_controlled_team_auth_evidence_key'|'capture_controlled_team_w2_preservation',args:Record<string,unknown>,maximum:number,deadline:number){
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([(async()=>{const response=await fetchImpl(`https://${STAGING_EVIDENCE_PROJECT}.supabase.co/rest/v1/rpc/${name}`,{method:'POST',headers:{Authorization:'Bearer '+serviceRole,apikey:serviceRole,'x-aca-w2-evidence-key':evidenceChannelHeader(key),'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',cache:'no-store',signal:controller.signal});if(response.status!==200||response.redirected)throw fail();return boundedJSON(response,maximum,controller.signal);})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail());},deadline);})]);}
  catch{controller.abort();throw fail();}finally{clearTimeout(timer);}
 }
 return Object.freeze({context,async capability(){
  if(capabilitySpent)throw fail();capabilitySpent=true;
  try{
  const challenge=randomBytes(32).toString('hex'),message=['aca-w2-auth-evidence-v1','challenge',EVIDENCE_ROOT,'-',participant,user,'capability','-',challenge].join('\n');
  const receipt=capabilitySchema.parse(await request('check_controlled_team_auth_evidence_key',{p_run_id:EVIDENCE_ROOT,p_window_id:null,p_participant_id:participant,p_user_id:user,p_operation:'capability',p_reservation_id:null,p_challenge:challenge,p_challenge_mac:evidenceChannelMAC(key,message)},8192,10000));
  return Object.freeze({matched:true as const,context,project:STAGING_EVIDENCE_PROJECT,serverNow:receipt.server_now,HTTP:200 as const,readOnly:true as const,W2Authorized:false as const});
  }catch{throw fail();}
 },async capture(){
  if(captureSpent)throw fail();captureSpent=true;
  try{
  const raw=await request('capture_controlled_team_w2_preservation',{p_run_id:EVIDENCE_ROOT,p_plan_sha256:context.approvedPlanSHA256,p_application_sha:context.canonicalAppSHA},48*1024*1024,45000);
  const snapshot=validateAcceptedStageSnapshot(raw,context),fingerprint=acceptedStageCaptureFingerprint(snapshot,context);
  return {snapshot,fingerprint};
  }catch{throw fail();}
 }});
}
