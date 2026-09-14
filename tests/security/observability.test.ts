import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const health = readFileSync("src/app/api/health/route.ts", "utf8");
const answers = readFileSync("src/app/api/diagnostics/[diagnosticId]/answers/route.ts", "utf8");
const submit = readFileSync("src/app/api/diagnostics/[diagnosticId]/submit/route.ts", "utf8");
const summary = readFileSync("src/server/worker/operations.ts", "utf8");

describe("production observability boundaries", () => {
  it("keeps liveness lightweight and non-sensitive", () => {
    expect(health).toContain('status: "ok"');
    expect(health).toContain("force-static");
    expect(health).not.toContain("createAdminClient");
    expect(health).not.toContain("OPENAI");
  });
  it("returns stable errors without exposing exception text", () => {
    expect(answers).not.toContain("error.message : \"invalid_request\"");
    expect(submit).not.toContain("e.message : \"submit_failed\"");
  });
  it("exposes queue state through a server-side summary helper", () => {
    expect(summary).toContain("queued");
    expect(summary).toContain("expired_leases");
    expect(summary).toContain("terminal_failed");
  });
});
