import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ limit: vi.fn(), secret: "unit-only-auth-secret-with-more-than-32-characters" }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: state.limit }));
vi.mock("@/server/supabase/config", () => ({ authConfig: () => ({ AUTH_FLOW_SECRET: state.secret }) }));
import { enforceRegistrationLimits, isRegistrationHoneypotFilled } from "@/server/auth/abuse-limits";

function keys() { return state.limit.mock.calls.map((call) => call[0] as string); }

beforeEach(() => {
  vi.stubEnv("RENDER", "true");
  state.secret = "unit-only-auth-secret-with-more-than-32-characters";
  state.limit.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("registration abuse limits", () => {
  it("uses separate distributed counters with the requested limits and windows", async () => {
    await enforceRegistrationLimits("Person@Example.test", new Headers({ "cf-connecting-ip": "203.0.113.8" }));
    expect(state.limit.mock.calls.map((call) => call.slice(1))).toEqual([[3, 60], [10, 3600], [1, 60], [5, 86400]]);
    expect(keys()[0]).toMatch(/^auth:register:ip-minute:[a-f0-9]{64}$/);
    expect(keys()[1]).toMatch(/^auth:register:ip-hour:[a-f0-9]{64}$/);
    expect(keys()[2]).toMatch(/^auth:register:email-minute:[a-f0-9]{64}$/);
    expect(keys()[3]).toMatch(/^auth:register:email-day:[a-f0-9]{64}$/);
    expect(new Set(keys()).size).toBe(4);
    expect(keys().join(" ")).not.toContain("Person");
    expect(keys().join(" ")).not.toContain("203.0.113");
  });

  it("normalizes an email before limiting it and isolates email changes from IP counters", async () => {
    const headers = new Headers({ "cf-connecting-ip": "203.0.113.8" });
    await enforceRegistrationLimits(" Person@Example.test ", headers);
    const first = keys();
    state.limit.mockClear();
    await enforceRegistrationLimits("person@example.test", headers);
    expect(keys()).toEqual(first);
    state.limit.mockClear();
    await enforceRegistrationLimits("another@example.test", headers);
    expect(keys().slice(0, 2)).toEqual(first.slice(0, 2));
    expect(keys()[2]).not.toBe(first[2]);
  });

  it("keys counters with the deployment secret rather than reversible email or IP hashes", async () => {
    const headers = new Headers({ "cf-connecting-ip": "203.0.113.8" });
    await enforceRegistrationLimits("person@example.test", headers);
    const first = keys();
    state.secret = "a-different-unit-only-auth-secret-with-more-than-32-characters";
    state.limit.mockClear();
    await enforceRegistrationLimits("person@example.test", headers);
    expect(keys().every((key, index) => key !== first[index])).toBe(true);
  });

  it("uses Render's Cloudflare client address despite caller-supplied XFF prefixes", async () => {
    await enforceRegistrationLimits("person@example.test", new Headers({ "cf-connecting-ip": "203.0.113.8", "x-forwarded-for": "198.51.100.1, 192.0.2.1" }));
    const first = keys();
    state.limit.mockClear();
    await enforceRegistrationLimits("person@example.test", new Headers({ "cf-connecting-ip": "203.0.113.8", "x-forwarded-for": "198.51.100.99, 192.0.2.2" }));
    expect(keys()).toEqual(first);
  });

  it("ignores spoofable XFF prefixes when falling back without a Cloudflare address", async () => {
    await enforceRegistrationLimits("person@example.test", new Headers({ "x-forwarded-for": "198.51.100.1, 203.0.113.8" }));
    const first = keys();
    state.limit.mockClear();
    await enforceRegistrationLimits("person@example.test", new Headers({ "x-forwarded-for": "198.51.100.99, 203.0.113.8" }));
    expect(keys()).toEqual(first);
  });

  it("does not trust a Cloudflare header outside the Render ingress", async () => {
    vi.stubEnv("RENDER", "false");
    await enforceRegistrationLimits("person@example.test", new Headers({ "cf-connecting-ip": "203.0.113.8", "x-forwarded-for": "198.51.100.7" }));
    const first = keys();
    state.limit.mockClear();
    await enforceRegistrationLimits("person@example.test", new Headers({ "cf-connecting-ip": "203.0.113.99", "x-forwarded-for": "198.51.100.7" }));
    expect(keys()).toEqual(first);
  });

  it("shares counters across equivalent IPv6 spellings", async () => {
    await enforceRegistrationLimits("person@example.test", new Headers({ "cf-connecting-ip": "2001:db8::1" }));
    const first = keys();
    state.limit.mockClear();
    await enforceRegistrationLimits("person@example.test", new Headers({ "cf-connecting-ip": "2001:0db8:0:0:0:0:0:1" }));
    expect(keys()).toEqual(first);
  });

  it("does not create attacker-controlled buckets from invalid or missing addresses", async () => {
    await enforceRegistrationLimits("person@example.test", new Headers({ "cf-connecting-ip": "not-an-ip", "x-forwarded-for": "invalid" }));
    const first = keys();
    state.limit.mockClear();
    await enforceRegistrationLimits("person@example.test", new Headers());
    expect(keys()).toEqual(first);
  });

  it("fails closed and stops consuming later windows if the RPC rejects or is unavailable", async () => {
    const rejected = new Error("rate_limited");
    state.limit.mockRejectedValueOnce(rejected);
    await expect(enforceRegistrationLimits("person@example.test", new Headers())).rejects.toBe(rejected);
    expect(state.limit).toHaveBeenCalledTimes(1);
    state.limit.mockReset().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("rate_limit_unavailable"));
    await expect(enforceRegistrationLimits("person@example.test", new Headers())).rejects.toThrow("rate_limit_unavailable");
    expect(state.limit).toHaveBeenCalledTimes(2);
  });

  it("flags only a filled honeypot, without rejecting fast autofill or empty optional fields", () => {
    expect(isRegistrationHoneypotFilled("")).toBe(false);
    expect(isRegistrationHoneypotFilled(" \t ")).toBe(false);
    expect(isRegistrationHoneypotFilled("https://spam.example.test")).toBe(true);
    expect(isRegistrationHoneypotFilled("robot")).toBe(true);
  });
});
