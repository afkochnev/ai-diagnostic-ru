import { createCipheriv,createDecipheriv,createHash,randomBytes } from "node:crypto";
import { z } from "zod";
const ttl=7*86400*1000;
const schema=z.object({email:z.email().max(254),company:z.string().min(1).max(200),team:z.string().min(1).max(200),inviter:z.string().min(1).max(100),invitationHash:z.string().regex(/^[a-f0-9]{64}$/),expires:z.number().finite()}).strict();
export type InvitationDetails=z.infer<typeof schema>;
function key(secret:string){return createHash("sha256").update(`team-invitation-display/v1/${secret}`).digest();}
export function sealInvitationDetails(value:Omit<InvitationDetails,"expires">,secret:string,now=Date.now()){
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(secret),iv);
  const body=Buffer.concat([cipher.update(JSON.stringify(schema.parse({...value,expires:now+ttl})),"utf8"),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString("base64url");
}
export function openInvitationDetails(envelope:string|undefined,hash:string,secret:string,now=Date.now()):InvitationDetails|null{
  if(!envelope || envelope.length>4096 || !/^[A-Za-z0-9_-]+$/.test(envelope))return null;
  try{const data=Buffer.from(envelope,"base64url"),decipher=createDecipheriv("aes-256-gcm",key(secret),data.subarray(0,12));decipher.setAuthTag(data.subarray(12,28));
    const value=schema.parse(JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString("utf8")));
    return value.invitationHash===hash && value.expires>now && value.expires<=now+ttl ? value:null;
  }catch{return null;}
}
export function maskTeamEmail(email:string){const [local,domain]=email.split("@");return `${local.slice(0,1)}***@${domain}`;}
