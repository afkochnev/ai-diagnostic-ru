import { afterEach, expect, it, vi } from "vitest";
import { stagingAccessEmailEnabled } from "@/server/acquisition/staging-email";

afterEach(() => vi.unstubAllEnvs());

it("allows actual delivery only for the configured session and recipient on staging", () => {
  vi.stubEnv("APP_URL", "https://ai-diagnostic-staging-web.onrender.com");
  vi.stubEnv("SUPABASE_URL", "https://vflgxgdwlftlyjslyrmo.supabase.co");
  vi.stubEnv("ACQUISITION_STAGING_EMAIL", "");
  expect(stagingAccessEmailEnabled("session", "test@example.test")).toBe(false);
  vi.stubEnv("ACQUISITION_STAGING_EMAIL", "session test@example.test");
  expect(stagingAccessEmailEnabled("session", "test@example.test")).toBe(true);
  expect(stagingAccessEmailEnabled("other", "test@example.test")).toBe(false);
  expect(stagingAccessEmailEnabled("session", "other@example.test")).toBe(false);
  vi.stubEnv("SUPABASE_URL", "https://fhvxqeaujjeiflanqsbg.supabase.co");
  expect(stagingAccessEmailEnabled("session", "test@example.test")).toBe(false);
});
