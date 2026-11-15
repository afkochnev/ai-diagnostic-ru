import { describe, expect, it, vi } from "vitest";
import { LEGACY_PUBLIC_APP_ORIGIN, PRODUCTION_SUPABASE_URL, PUBLIC_APP_ORIGIN } from "@/shared/app-origin";
import { isAppRequestOrigin, isLegacyContinuationOrigin } from "@/server-runtime/app-request-origin";

describe("old domain continuations", () => {
  const legacy = new Headers({ origin: LEGACY_PUBLIC_APP_ORIGIN, host: new URL(LEGACY_PUBLIC_APP_ORIGIN).host });
  const production = { NODE_ENV: "production", APP_URL: PUBLIC_APP_ORIGIN, SUPABASE_URL: PRODUCTION_SUPABASE_URL };

  it("requires host, origin, the active new domain and the verified production project", () => {
    expect(isLegacyContinuationOrigin(legacy, production)).toBe(true);
    const forwardedOnly = new Headers({ origin: LEGACY_PUBLIC_APP_ORIGIN, host: "foreign.example", "x-forwarded-host": new URL(LEGACY_PUBLIC_APP_ORIGIN).host });
    expect(isLegacyContinuationOrigin(forwardedOnly, production)).toBe(false);
    expect(isLegacyContinuationOrigin(new Headers({ host: new URL(LEGACY_PUBLIC_APP_ORIGIN).host }), production)).toBe(false);
    expect(isLegacyContinuationOrigin(legacy, { ...production, SUPABASE_URL: "https://vflgxgdwlftlyjslyrmo.supabase.co" })).toBe(false);
    expect(isLegacyContinuationOrigin(legacy, { ...production, APP_URL: LEGACY_PUBLIC_APP_ORIGIN })).toBe(false);
    expect(isLegacyContinuationOrigin(legacy, { ...production, NODE_ENV: "test" })).toBe(false);
  });

  it("still requires explicit legacy permission at each action", () => {
    for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value);
    try {
      expect(isAppRequestOrigin(legacy, PUBLIC_APP_ORIGIN)).toBe(false);
      expect(isAppRequestOrigin(legacy, PUBLIC_APP_ORIGIN, true)).toBe(true);
      expect(isAppRequestOrigin(legacy, LEGACY_PUBLIC_APP_ORIGIN)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
