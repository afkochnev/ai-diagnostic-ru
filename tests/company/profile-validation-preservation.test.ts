import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const action = readFileSync("src/server/company/actions.ts", "utf8");
const form = readFileSync("src/features/company/company-profile-form.tsx", "utf8");

describe("company profile validation preservation", () => {
  it("returns submitted values with validation failures", () => {
    expect(action).toContain("function submittedValues(form: FormData)");
    expect(action).toContain("fieldErrors: fieldErrors(parsed.error.issues), values");
  });

  it("keeps text, textarea and select controls bound to preserved values", () => {
    expect(form).toContain("useState<Record<string, string>>");
    expect(form).toContain("next.values");
    expect(form).toContain('value={value("industry_key")}');
    expect(form).toContain("value={value}");
    expect(form).toContain("<textarea");
  });
});
