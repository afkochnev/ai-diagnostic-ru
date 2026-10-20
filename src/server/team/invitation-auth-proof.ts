import "server-only";
import {createCipheriv,createDecipheriv,createHash,randomBytes} from "node:crypto";
import {z} from "zod";

// Protects a Supabase-issued credential in transit/HttpOnly context; it does not
// issue authentication tokens or sessions. Never return this envelope to owners.
export const invitationAuthTtl=30*60*1000;
const schema=z.object({email:z.email(),invitationHash:z.string().regex(/^[a-f0-9]{64}$/),tokenHash:z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),type:z.enum(["invite","magiclink"]),expires:z.number().finite()}).strict();
export type InvitationAuthProof=z.infer<typeof schema>;
const key=(secret:string)=>createHash("sha256").update(`team-supabase-proof/v1/${secret}`).digest();
export function sealInvitationAuthProof(value:Omit<InvitationAuthProof,"expires">,secret:string,now=Date.now()){
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(secret),iv);
 const body=Buffer.concat([cipher.update(JSON.stringify(schema.parse({...value,expires:now+invitationAuthTtl})),"utf8"),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),body]).toString("base64url");
}
export function openInvitationAuthProof(envelope:string|undefined,invitationHash:string,secret:string,now=Date.now()):InvitationAuthProof|null{
 if(!envelope || envelope.length>2048 || !/^[A-Za-z0-9_-]+$/.test(envelope))return null;
 try{
  const data=Buffer.from(envelope,"base64url"),decipher=createDecipheriv("aes-256-gcm",key(secret),data.subarray(0,12));
  decipher.setAuthTag(data.subarray(12,28));
  const proof=schema.parse(JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString("utf8")));
  return proof.invitationHash===invitationHash && proof.expires>now && proof.expires<=now+invitationAuthTtl?proof:null;
 }catch{return null;}
}
