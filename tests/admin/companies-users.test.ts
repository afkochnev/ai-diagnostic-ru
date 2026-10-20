import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("src/server/admin/companies-users.ts", "utf8");
const shell = readFileSync("src/features/admin/console-ui.tsx", "utf8");

describe("Stage 8D companies and users", () => {
  it("uses the shared admin boundary and batched read projections", () => {
    expect(service.match(/await requireAdmin\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(service).toContain("Promise.all");
    expect(service).not.toContain("insert(");
    expect(service).not.toContain("update(");
    expect(service).not.toContain("structured_content");
    expect(service).not.toContain("answers");
  });

  it("uses current account membership and explicit creator-history ordering", () => {
    expect(service).toContain('from("account_memberships")');
    expect(service).toContain('.eq("role", "owner").eq("status", "active")');
    expect(service).toContain('companies: companies ?? []');
    expect(service).not.toContain('eq("owner_user_id", userId).maybeSingle()');
    expect(service).toContain('order("started_at", { ascending: false })');
    expect(service).toContain("industry_translations");
    expect(service).toContain("revenue_range_translations");
  });

  it("exposes read-only navigation for companies and users", () => {
    expect(shell).toContain('"Компании","companies"');
    expect(readFileSync("src/app/[locale]/(admin)/admin/companies/[companyId]/page.tsx", "utf8")).toContain('section="companies"');
    expect(readFileSync("src/app/[locale]/(admin)/admin/users/[userId]/page.tsx", "utf8")).toContain('section="users"');
  });
});
