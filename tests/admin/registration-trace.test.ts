import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const action = readFileSync("src/server/auth/actions.ts", "utf8");
const form = readFileSync("src/features/auth/auth-form.tsx", "utf8");

describe("registration action", () => {
  it("keeps signup diagnostics out of production code", () => {
    expect(action).not.toContain("REG_");
    expect(readFileSync("src/server/supabase/server.ts", "utf8")).not.toContain("REG_AUTH_HTTP_");
  });

  it("keeps validation and navigation in the server action flow", () => {
    expect(form).toContain("action={formAction}");
    expect(form).toContain('type="submit"');
    expect(form).toContain("event.preventDefault()");
    expect(form).not.toContain("/ru/verify-email");
  });

  it("sends successful signup confirmation to the existing landing route", () => {
    expect(action).toContain('redirect("/ru?welcome=1")');
    const confirmation = action.slice(action.indexOf("export async function confirmAction"), action.indexOf("export async function resetAction"));
    expect(confirmation).not.toContain('redirect("/ru/company-profile")');
    const landing = readFileSync("src/app/[locale]/(public)/page.tsx", "utf8");
    expect(landing).toContain("authenticated");
    expect(landing).toContain("LandingPage");
  });

  it("preserves identity validation and landing confirmation flow", () => {
    expect(action).toContain("hasCreatedAuthUser(data)");
    expect(action).toContain('redirect("/ru?welcome=1")');
  });
});
