import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("src/app/[locale]/(workspace)/dashboard/page.tsx", "utf8");

describe("active diagnostic dashboard controls", () => {
  it("disables new diagnostic while an active attempt exists", () => {
    const activeBranch = page.slice(page.indexOf("{activeDiagnostic ?"), page.indexOf(": <form action={startDiagnosticAction}"));
    expect(activeBranch).toContain('href={`/ru/diagnostics/${activeDiagnostic.id}`}');
    expect(activeBranch).toContain('type="button" disabled');
    expect(activeBranch).not.toContain("<form action={startDiagnosticAction}");
    const disabledControl = activeBranch.slice(activeBranch.indexOf('<button type="button" disabled'), activeBranch.indexOf('</button>') + '</button>'.length);
    expect(disabledControl).not.toContain('href=');
    expect(disabledControl).not.toContain('formAction=');
    expect(disabledControl).not.toContain('onClick=');
    expect(disabledControl).toContain('aria-disabled="true"');
    expect(disabledControl).toContain('tabIndex={-1}');
  });

  it("keeps creation available only in the no-active branch", () => {
    const noActiveBranch = page.slice(page.indexOf(": <form action={startDiagnosticAction}"));
    expect(noActiveBranch).toContain("startDiagnosticAction");
    expect(noActiveBranch).toContain('type="submit"');
  });
});
