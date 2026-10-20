import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { invitationToken } from "./contracts";
const TTL = 30 * 60 * 1000;
function key(secret: string) { return createHash("sha256").update(`team-invitation-cookie/v1/${secret}`).digest(); }
export function sealInvitation(token: string, secret: string, now = Date.now()) {
  invitationToken.parse(token);
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify({ token, expires: now + TTL }), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64url");
}
export function openInvitationContext(envelope: string | undefined, secret: string, now = Date.now()): {token:string;expires:number} | null {
  if (!envelope || envelope.length > 512 || !/^[A-Za-z0-9_-]+$/.test(envelope)) return null;
  try {
    const data = Buffer.from(envelope, "base64url"), decipher = createDecipheriv("aes-256-gcm", key(secret), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const parsed = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"));
    if (!Number.isFinite(parsed.expires) || parsed.expires <= now || parsed.expires > now + TTL || !invitationToken.safeParse(parsed.token).success) return null;
    return {token:parsed.token,expires:parsed.expires};
  } catch { return null; }
}
export function openInvitation(envelope: string | undefined, secret: string, now = Date.now()): string | null { return openInvitationContext(envelope,secret,now)?.token ?? null; }
