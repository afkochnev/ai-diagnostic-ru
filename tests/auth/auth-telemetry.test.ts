import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/server/auth/actions.ts", "utf8");
const telemetry = source.slice(source.indexOf('const telemetry ='), source.indexOf('if (!data?.user)'));

describe("safe auth confirmation telemetry", () => {
  it("records only safe request and outcome metadata", () => {
    expect(telemetry).toContain('route: "/auth/confirm"');
    expect(telemetry).toContain("request_host");
    expect(telemetry).toContain("pkce_verifier_present");
    expect(telemetry).toContain("exchange_attempted");
    expect(telemetry).toContain("session_present");
    expect(telemetry).toContain("user_present");
    expect(telemetry).not.toContain("console.info(\"[auth-confirm]\", code");
    expect(telemetry).not.toContain("console.info(\"[auth-confirm]\", token_hash");
    expect(telemetry).not.toContain("console.info(\"[auth-confirm]\", requestCookies");
    expect(telemetry).not.toContain("requestCookies.getAll().map((cookie) => cookie.value)");
  });

  it("classifies failures without logging provider messages or values", () => {
    expect(telemetry).toContain("pkce_verifier_missing");
    expect(telemetry).toContain("auth_code_exchange_failed");
    expect(telemetry).not.toContain("exchangeError.message");
    expect(telemetry).not.toContain("OPENAI_API_KEY");
    expect(telemetry).not.toContain("RESEND_API_KEY");
  });
});
