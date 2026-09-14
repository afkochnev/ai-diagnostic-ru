import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260916000400_rate_limits.sql", "utf8");
const reports = readFileSync("src/app/api/diagnostics/[diagnosticId]/reports/route.ts", "utf8");
const pdf = readFileSync("src/app/api/reports/[reportId]/pdf/prepare/route.ts", "utf8");
const email = readFileSync("src/app/api/reports/[reportId]/email/route.ts", "utf8");
const lead = readFileSync("src/app/api/lead-requests/route.ts", "utf8");

describe("shared mutation rate limits", () => {
  it("uses a database-backed atomic window function", () => {
    expect(migration).toContain("on conflict (key, window_start) do update");
    expect(migration).toContain("returning count into row_count");
    expect(migration).toContain("grant execute on function public.consume_rate_limit");
  });
  it("protects expensive and externally costly mutations with server identity", () => {
    for (const source of [reports, pdf, email, lead]) {
      expect(source).toContain("enforceRateLimit");
      expect(source).toContain("RateLimitExceeded");
      expect(source).toContain("status: 429");
    }
    expect(reports).toContain("identity.user.id");
  });
});
