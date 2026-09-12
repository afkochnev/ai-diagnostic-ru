import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/diagnostics/[diagnosticId]/score/route.ts", "utf8");

describe("Stage 9A scoring ownership boundary", () => {
  it("authorizes the exact owner and company before the privileged worker", () => {
    expect(route.indexOf("await getIdentity()")) .toBeLessThan(route.indexOf("await runScoringJob"));
    expect(route).toContain('eq("created_by_user_id", identity.user.id)');
    expect(route).toContain('eq("owner_user_id", identity.user.id)');
    expect(route).toContain('return NextResponse.json({ error: "not_found" }, { status: 404 })');
  });

  it("keeps scoring lifecycle narrow and never trusts client ownership fields", () => {
    expect(route).toContain('new Set(["submitted", "scoring_failed"])');
    expect(route).toContain('diagnostic.status === "completed"');
    expect(route).toContain('diagnostic.status === "scoring"');
    expect(route).not.toContain("request.json");
    expect(route).not.toContain("company_id: body");
  });
});
