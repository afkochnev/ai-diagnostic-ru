// Pure Node boundary. No environment or credential reads occur on import.
import {createHmac} from 'node:crypto';
import {z} from 'zod';

export const EVIDENCE_KEY_DOMAIN='aca-w2-evidence-key' as const;
export const EVIDENCE_KEY_ALGORITHM='HMAC-SHA256' as const;
export const evidenceKeyContextSchema=z.strictObject({
 domain:z.literal(EVIDENCE_KEY_DOMAIN),version:z.literal(1),
 rootRunId:z.uuid().refine(value=>value===value.toLowerCase()),
 approvedPlanSHA256:z.string().regex(/^[a-f0-9]{64}$/),
 canonicalAppSHA:z.string().regex(/^[a-f0-9]{40}$/),
});
export type EvidenceKeyContext=Readonly<z.infer<typeof evidenceKeyContextSchema>>;
export type EvidenceChannelKey=Readonly<{kind:'controlled-team-evidence-key-v1'}>;
const material=new WeakMap<EvidenceChannelKey,Buffer>();
const contexts=new WeakMap<EvidenceChannelKey,EvidenceKeyContext>();
const unavailable=()=>Error('controlled_team_evidence_key_unavailable');

export function evidenceKeyContext(value:unknown):EvidenceKeyContext{
 try{return Object.freeze(evidenceKeyContextSchema.parse(value));}catch{throw unavailable();}
}
/** Only the nonsecret canonical context is serialized; clocks never enter it. */
export function evidenceKeyContextMessage(value:EvidenceKeyContext):string{
 const c=evidenceKeyContext(value);
 return [c.domain,String(c.version),c.rootRunId,c.approvedPlanSHA256,c.canonicalAppSHA].join('\n');
}
/** Key bytes stay private. A handle cannot be cloned or constructed by callers. */
export function deriveEvidenceChannelKey(authFlowSecret:string,value:EvidenceKeyContext):EvidenceChannelKey{
 try{
  if(typeof authFlowSecret!=='string'||Buffer.byteLength(authFlowSecret,'utf8')<32||Buffer.byteLength(authFlowSecret,'utf8')>4096||!authFlowSecret.isWellFormed())throw unavailable();
  const context=evidenceKeyContext(value),key=createHmac('sha256',Buffer.from(authFlowSecret,'utf8')).update(evidenceKeyContextMessage(context),'utf8').digest();
  const handle=Object.freeze({kind:'controlled-team-evidence-key-v1' as const});material.set(handle,key);contexts.set(handle,context);return handle;
 }catch{throw unavailable();}
}
function owned(key:EvidenceChannelKey):Buffer{
 const value=key&&typeof key==='object'?material.get(key):undefined;
 if(!value||value.byteLength!==32)throw unavailable();return value;
}
/** The only raw derived-key serialization, for the transient service RPC header. */
export function evidenceChannelHeader(key:EvidenceChannelKey):string{return 'aca-w2-v1.'+owned(key).toString('hex');}
export function assertEvidenceChannelScope(key:EvidenceChannelKey,rootRunId:string,approvedPlanSHA256:string):void{
 owned(key);const context=contexts.get(key);
 if(context?.rootRunId!==rootRunId||context.approvedPlanSHA256!==approvedPlanSHA256)throw unavailable();
}
export function assertEvidenceChannelContext(key:EvidenceChannelKey,expected:EvidenceKeyContext):void{
 owned(key);const context=contexts.get(key),value=evidenceKeyContext(expected);
 if(!context||context.domain!==value.domain||context.version!==value.version||context.rootRunId!==value.rootRunId||context.approvedPlanSHA256!==value.approvedPlanSHA256||context.canonicalAppSHA!==value.canonicalAppSHA)throw unavailable();
}
export function evidenceChannelMAC(key:EvidenceChannelKey,message:string):string{
 if(typeof message!=='string'||!message.isWellFormed())throw unavailable();
 return createHmac('sha256',owned(key)).update(message,'utf8').digest('hex');
}
