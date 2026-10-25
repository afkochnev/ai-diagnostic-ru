// Pure Node contract. It never reads environment variables or exports a credential.
import {createHmac} from 'node:crypto';
import {z} from 'zod';

const uuid=z.uuid().refine(value=>value===value.toLowerCase());
export const authWireScopeSchema=z.strictObject({
 runId:uuid,windowId:uuid,participantId:uuid,userId:uuid,
 operation:z.enum(['issue','verify']),reservationId:uuid,planHash:z.string().regex(/^[a-f0-9]{64}$/),
});
export type AuthWireScope=z.infer<typeof authWireScopeSchema>;
export type AuthWireOutcome='succeeded'|'failed'|'unknown';
export type AuthWireFinish={dispatchedAt:string|null;receivedAt:string|null;httpStatus:number|null;outcome:AuthWireOutcome;tokenHash:string|null;responseIdentityMatches:boolean};
export interface AuthWireEvidence {
 begin(tokenHash:string|null):Promise<void>;
 finish(value:AuthWireFinish):Promise<void>;
}
const credential=z.string().regex(/^[A-Za-z0-9_-]{32,256}$/);
const authorization=z.string().regex(/^Bearer [A-Za-z0-9._-]{20,4096}$/);
const prefix='aca-w2-auth-evidence-v1';
function scopePrefix(scope:AuthWireScope){
 const s=authWireScopeSchema.parse(scope);
 return [s.runId,s.windowId,s.participantId,s.userId].join('\n');
}
export function authCredentialMAC(scope:AuthWireScope,bearer:string,token:string){
 return createHmac('sha256',authorization.parse(bearer)).update(`${prefix}\ncredential\n${scopePrefix(scope)}\n${credential.parse(token)}`,'utf8').digest('hex');
}
export function authChallengeMAC(scope:AuthWireScope,bearer:string,challenge:string){
 return createHmac('sha256',authorization.parse(bearer)).update(`${prefix}\nchallenge\n${scopePrefix(scope)}\n${scope.operation}\n${scope.reservationId}\n${z.string().regex(/^[a-f0-9]{64}$/).parse(challenge)}`,'utf8').digest('hex');
}

/** A response clone is read privately and bounded; no body/error is returned to
 * logs, traces or callers other than the canonical Auth parser. */
export async function readAuthWireJSON(response:Response):Promise<unknown>{
 const reader=response.clone().body?.getReader();
 if(!reader)throw Error('controlled_team_auth_evidence_unavailable');
 const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw Error('response_limit');chunks.push(value);}
  const bytes=Buffer.concat(chunks);return JSON.parse(bytes.toString('utf8'));
 }catch{void reader.cancel().catch(()=>{});throw Error('controlled_team_auth_evidence_unavailable');}
 finally{reader.releaseLock();}
}
