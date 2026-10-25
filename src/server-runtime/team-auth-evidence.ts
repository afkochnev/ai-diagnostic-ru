// Server/standalone Node only. Import is inert; secrets stay in this closure.
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {createRuntimeEvidenceRPC,createRuntimeEvidenceChannel as runtimeChannel,runtimeEvidenceKeyContext} from './team-evidence-channel';
import type {EvidenceChannelKey} from '@/server/team/evidence-channel-key';
import {authChallengeMAC,authCredentialMAC,authWireScopeSchema,type AuthWireEvidence,type AuthWireFinish,type AuthWireScope} from '@/server/team/auth-wire-contract';

const unavailable=()=>Error('controlled_team_auth_evidence_unavailable');
const scopeFields={run_id:z.uuid(),window_id:z.uuid(),participant_id:z.uuid(),user_id:z.uuid(),operation:z.enum(['issue','verify']),reservation_id:z.uuid(),approved_plan_hash:z.string().regex(/^[a-f0-9]{64}$/)};
const checkSchema=z.strictObject({...scopeFields,matched:z.boolean(),server_now:z.iso.datetime({offset:true})});
const beginSchema=z.strictObject({...scopeFields,trace_id:z.uuid().nullable(),admitted:z.boolean(),status:z.enum(['reserved','blocked']),server_now:z.iso.datetime({offset:true}),credential_match:z.boolean().nullable()});
const finishSchema=z.strictObject({...scopeFields,trace_id:z.uuid(),status:z.enum(['succeeded','failed','unknown']),credential_match:z.boolean(),dispatched_at:z.iso.datetime({offset:true}).nullable(),received_at:z.iso.datetime({offset:true}).nullable(),http_status:z.number().int().min(100).max(599).nullable(),response_identity_matches:z.boolean()});
type Receipt=z.infer<typeof checkSchema>|z.infer<typeof beginSchema>|z.infer<typeof finishSchema>;
const sameInstant=(a:string|null,b:string|null)=>a===null||b===null?a===b:Date.parse(a)===Date.parse(b);
function sameScope(value:Receipt,scope:AuthWireScope){
 if(value.run_id!==scope.runId||value.window_id!==scope.windowId||value.participant_id!==scope.participantId||value.user_id!==scope.userId||value.operation!==scope.operation||value.reservation_id!==scope.reservationId||value.approved_plan_hash!==scope.planHash)throw unavailable();
}
type EvidencePorts={key:EvidenceChannelKey;rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>};
/** Explicit ports exist for fake-HTTP tests. Production callers use only the
 * default fixed RPC client below; no token or new key is ever a RPC argument. */
export function createRuntimeEvidenceChannel(scope:{runId:string;planHash:string},env:Record<string,string|undefined>=process.env){
 return runtimeChannel(runtimeEvidenceKeyContext(scope.runId,scope.planHash,env),env);
}
export function createAuthWireEvidence(scopeValue:AuthWireScope,ports?:EvidencePorts):AuthWireEvidence{
 const scope=authWireScopeSchema.parse(scopeValue);
 const p=ports??createRuntimeEvidenceRPC(createRuntimeEvidenceChannel(scope).context);let begun=false,finished=false,traceId:string|undefined;
 const args={p_run_id:scope.runId,p_window_id:scope.windowId,p_participant_id:scope.participantId,p_user_id:scope.userId,p_operation:scope.operation,p_reservation_id:scope.reservationId};
 return Object.freeze({
  async begin(tokenHash:string|null){
   if(begun||finished)throw unavailable();begun=true;
   try{
    if(scope.operation==='issue'?tokenHash!==null:tokenHash===null)throw unavailable();
    const challenge=randomBytes(32).toString('hex');
    const proof={...args,p_challenge:challenge,p_challenge_mac:authChallengeMAC(scope,p.key,challenge)};
    const check=checkSchema.parse(await p.rpc('check_controlled_team_auth_evidence_key',proof));sameScope(check,scope);if(!check.matched)throw unavailable();
    const receipt=beginSchema.parse(await p.rpc('begin_controlled_team_auth_wire',{...proof,p_credential_mac:tokenHash===null?null:authCredentialMAC(scope,p.key,tokenHash)}));sameScope(receipt,scope);
    if(!receipt.admitted||receipt.status!=='reserved'||!receipt.trace_id||scope.operation==='verify'&&receipt.credential_match!==true||scope.operation==='issue'&&receipt.credential_match!==null)throw unavailable();
    traceId=receipt.trace_id;
   }catch{throw unavailable();}
  },
  async finish(value:AuthWireFinish){
   if(!begun||!traceId||finished)throw unavailable();finished=true;
   try{
    const receipt=finishSchema.parse(await p.rpc('finish_controlled_team_auth_wire',{p_trace_id:traceId,p_dispatched_at:value.dispatchedAt,p_received_at:value.receivedAt,p_http_status:value.httpStatus,p_outcome:value.outcome,p_credential_mac:value.tokenHash===null?null:authCredentialMAC(scope,p.key,value.tokenHash),p_response_identity_matches:value.responseIdentityMatches}));sameScope(receipt,scope);
    if(receipt.trace_id!==traceId||receipt.status!==value.outcome||!sameInstant(receipt.dispatched_at,value.dispatchedAt)||!sameInstant(receipt.received_at,value.receivedAt)||receipt.http_status!==value.httpStatus||receipt.response_identity_matches!==value.responseIdentityMatches||value.outcome==='succeeded'&&!receipt.credential_match)throw unavailable();
   }catch{throw unavailable();}
  },
 });
}
