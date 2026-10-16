import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
const ttl = 10 * 60 * 1000;
const schema = z.object({ email: z.email().max(254), invitationHash: z.string().regex(/^[a-f0-9]{64}$/), expires: z.number().finite() }).strict();
function key(secret: string) { return createHash("sha256").update(`team-passwordless/v1/${secret}`).digest(); }
export function sealTeamChallenge(email: string, invitationHash: string, secret: string, now=Date.now()) {
  const value = schema.parse({ email, invitationHash, expires: now+ttl });
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm",key(secret),iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),payload]).toString("base64url");
}
export function openTeamChallenge(envelope: string | undefined, invitationHash: string, secret: string, now=Date.now()) {
  if (!envelope || envelope.length>1024 || !/^[A-Za-z0-9_-]+$/.test(envelope)) return null;
  try {
    const data=Buffer.from(envelope,"base64url"), decipher=createDecipheriv("aes-256-gcm",key(secret),data.subarray(0,12));
    decipher.setAuthTag(data.subarray(12,28));
    const value=schema.parse(JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString("utf8")));
    if (value.invitationHash!==invitationHash || value.expires<=now || value.expires>now+ttl) return null;
    return value;
  } catch { return null; }
}
