import { describe, expect, it } from "vitest";
import { buildSignupMetadata, hasCreatedAuthUser, isDuplicateSignup } from "@/server/auth/registration-contract";

describe("registration consent contract", () => {
  it("serializes consent values as booleans with database versions", () => {
    const metadata = buildSignupMetadata({ full_name: "Admin fixture", data_processing_consent: true, marketing_consent: false, versions: { data_processing_version: "temporary-ru-v1", marketing_version: "temporary-ru-v1" } });
    expect(metadata.data_processing_consent).toBe(true);
    expect(metadata.marketing_consent).toBe(false);
    expect(metadata.data_processing_version).toBe("temporary-ru-v1");
  });

  it("detects confirmed and unconfirmed duplicate-email semantics without auth.users", () => {
    expect(isDuplicateSignup(null, { user: { identities: [] } })).toBe(true);
    expect(isDuplicateSignup({ code: "email_exists" }, null)).toBe(true);
    expect(isDuplicateSignup({ code: "user_already_exists" }, null)).toBe(true);
    expect(isDuplicateSignup({ code: "over_email_send_rate_limit" }, null)).toBe(false);
    expect(isDuplicateSignup(null, { user: { identities: [{ provider: "email" }] } })).toBe(false);
  });

  it("rejects missing required consent before signup", () => {
    const metadata = buildSignupMetadata({ full_name: "Admin fixture", data_processing_consent: false, marketing_consent: false, versions: {} });
    expect(metadata.data_processing_consent).toBe(false);
  });

  it("distinguishes a user-less response from a successful signup", () => {
    expect(hasCreatedAuthUser({ user: null })).toBe(false);
    expect(hasCreatedAuthUser({ user: { id: "fixture", identities: [] } })).toBe(false);
    expect(hasCreatedAuthUser({ user: { id: "fixture", identities: [{ provider: "email" }] } })).toBe(true);
    expect(hasCreatedAuthUser({ user: { id: "fixture", identities: [{ provider: "google" }] } })).toBe(false);
  });
});
