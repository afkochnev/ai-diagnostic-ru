import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("src/app/[locale]/(workspace)/dashboard/page.tsx", "utf8");

describe("active diagnostic dashboard controls", () => {
  it("disables new diagnostic while an active attempt exists", () => {
    const activeBranch = page.slice(page.indexOf("{activeDiagnostic ?"), page.indexOf(": <form action={startDiagnosticAction}"));
    expect(activeBranch).toContain('href={`/ru/diagnostics/${activeDiagnostic.id}`}');
    expect(activeBranch).toContain('type="button" disabled');
    expect(activeBranch).not.toContain("<form action={startDiagnosticAction}");
  });

  it("keeps creation available only in the no-active branch", () => {
    const noActiveBranch = page.slice(page.indexOf(": <form action={startDiagnosticAction}"));
    expect(noActiveBranch).toContain("startDiagnosticAction");
    expect(noActiveBranch).toContain('type="submit"');
  });
});
