import "server-only";
import {createCipheriv, createDecipheriv, createHash, randomBytes} from "node:crypto";

const codePattern = /^ITEAM-[A-F0-9]{24}$/;
const envelopePattern = /^v1\.[a-f0-9]{24}\.[a-f0-9]{60}\.[a-f0-9]{32}$/;
const context = "advanced-promo-display/v1";
const hashCode = (code: string) => createHash("sha256").update(code, "utf8").digest("hex");
function key(secret: string) {
  if (secret.length < 32) throw new Error("promo_display_key_unavailable");
  return createHash("sha256").update(`${context}/${secret}`, "utf8").digest();
}

// The existing server secret is domain-separated from auth links and invitations.
// Only the administrator list decrypts this value; redemption still uses SHA256.
export function sealAdminPromoCode(code: string, secret: string): string {
  if (!codePattern.test(code)) throw new Error("promo_invalid_code");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(`${context}:${hashCode(code)}`, "utf8"));
  const body = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return `v1.${iv.toString("hex")}.${body.toString("hex")}.${cipher.getAuthTag().toString("hex")}`;
}

export function openAdminPromoCode(envelope: string | null | undefined, hash: string | null | undefined, secret: string): string | null {
  if (!envelope || !hash || !envelopePattern.test(envelope) || !/^[a-f0-9]{64}$/.test(hash)) return null;
  try {
    const [, iv, body, tag] = envelope.split(".");
    const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "hex"));
    decipher.setAAD(Buffer.from(`${context}:${hash}`, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    const code = Buffer.concat([decipher.update(Buffer.from(body, "hex")), decipher.final()]).toString("utf8");
    return codePattern.test(code) && hashCode(code) === hash ? code : null;
  } catch {
    return null;
  }
}
