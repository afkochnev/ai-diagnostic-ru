import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';

export const controlledTeamW2ProofTtl=30*60*1000;
const proofSchema=z.object({runId:z.uuid(),windowId:z.uuid(),teamId:z.uuid(),participantId:z.uuid(),userId:z.uuid(),email:z.email(),invitationHash:z.string().regex(/^[a-f0-9]{64}$/),tokenHash:z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),type:z.literal('magiclink'),issuedAt:z.number().finite(),expires:z.number().finite()}).strict();
export type ControlledTeamW2Proof=z.infer<typeof proofSchema>;
const key=(secret:string)=>createHash('sha256').update(`team-w2-access-proof/v1/${secret}`).digest();
/** Fresh provider-issued credential, bound to W2 and its original exact identity.
 * This envelope cannot be opened as a legacy invitation and is never returned to
 * an administrator, an action response, a runner manifest or evidence output. */
export function sealControlledTeamW2Proof(value:Omit<ControlledTeamW2Proof,'issuedAt'|'expires'>,secret:string,expiresAt:number,now=Date.now()){
 const expires=Math.min(expiresAt,now+controlledTeamW2ProofTtl);
 if(expires<=now)throw Error('controlled_team_unavailable');
 const proof=proofSchema.parse({...value,issuedAt:now,expires});
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);
 const body=Buffer.concat([cipher.update(JSON.stringify(proof),'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');
}
export function openControlledTeamW2Proof(envelope:string|undefined,secret:string,now=Date.now()):ControlledTeamW2Proof|null{
 if(!envelope||envelope.length>3072||!/^[A-Za-z0-9_-]+$/.test(envelope))return null;
 try{
  const bytes=Buffer.from(envelope,'base64url'),decipher=createDecipheriv('aes-256-gcm',key(secret),bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));
  const proof=proofSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')));
  return proof.issuedAt<=now&&proof.expires>now&&proof.expires>proof.issuedAt&&proof.expires-proof.issuedAt<=controlledTeamW2ProofTtl?proof:null;
 }catch{return null;}
}
