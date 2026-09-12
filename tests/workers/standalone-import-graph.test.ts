import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("standalone worker import boundary", () => {
  it("contains no Next request/runtime imports", () => {
    const files = [
      "scripts/worker.ts",
      "src/server/worker/runner.ts",
      "src/server/scoring/worker.ts",
      "src/server/ai/worker.ts",
      "src/server/ai/report.ts",
      "src/server/consultation/worker.ts",
      "src/server/consultation/provider.ts",
      "src/server-runtime/supabase/admin.ts",
      "src/server-runtime/supabase/config.ts",
    ];
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/server-only|next\/(headers|cookies|server|navigation)|use server/);
  });
});
