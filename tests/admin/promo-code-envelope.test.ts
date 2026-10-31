import {createHash} from "node:crypto";
import {describe, expect, it, vi} from "vitest";
vi.mock("server-only", () => ({}));
import {openAdminPromoCode, sealAdminPromoCode} from "@/server/admin/promo-code-envelope";

const secret = "test-server-secret-for-promo-display-0123456789";
const code = `ITEAM-${"A1".repeat(12)}`;
const hash = createHash("sha256").update(code).digest("hex");

describe("administrator promo display encryption", () => {
  it("can reopen a persisted code with a fresh read and uses a different nonce for each envelope", () => {
    const first = sealAdminPromoCode(code, secret);
    const second = sealAdminPromoCode(code, secret);
    const stored = JSON.parse(JSON.stringify({code_ciphertext: first, code_hash: hash}));
    expect(first).toMatch(/^v1\.[a-f0-9]{24}\.[a-f0-9]{60}\.[a-f0-9]{32}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(code);
    expect(openAdminPromoCode(stored.code_ciphertext, stored.code_hash, secret)).toBe(code);
    expect(openAdminPromoCode(second, hash, secret)).toBe(code);
  });

  it("cannot decrypt under another key or attach a code to a different redemption hash", () => {
    const envelope = sealAdminPromoCode(code, secret);
    expect(openAdminPromoCode(envelope, hash, `${secret}-other`)).toBeNull();
    expect(openAdminPromoCode(envelope, "0".repeat(64), secret)).toBeNull();
    expect(openAdminPromoCode(envelope, hash, "short")).toBeNull();
  });

  it.each([1, 2, 3])("rejects tampering with envelope part %i", index => {
    const parts = sealAdminPromoCode(code, secret).split(".");
    parts[index] = `${parts[index][0] === "0" ? "1" : "0"}${parts[index].slice(1)}`;
    expect(openAdminPromoCode(parts.join("."), hash, secret)).toBeNull();
  });

  it.each([undefined, null, "", code, "v2.bad", "x".repeat(1000)])("does not invent a code for a missing or invalid envelope", envelope => {
    expect(openAdminPromoCode(envelope, hash, secret)).toBeNull();
  });

  it("fails issuance before persistence if the server key or generated code is invalid", () => {
    expect(() => sealAdminPromoCode(code, "short")).toThrow("promo_display_key_unavailable");
    expect(() => sealAdminPromoCode("client-code", secret)).toThrow("promo_invalid_code");
  });
});
