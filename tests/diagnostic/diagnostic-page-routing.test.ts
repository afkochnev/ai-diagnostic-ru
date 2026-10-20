import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  diagnostic: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
  notFound: vi.fn((): never => { throw new Error("not_found"); }),
}));

vi.mock("@/features/company/company-navigation", () => ({ CompanyNavigation: () => null }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/server/auth/session", () => ({ requireIdentity: mocks.identity }));
vi.mock("@/server/diagnostic/service", () => ({
  getDiagnostic: mocks.diagnostic,
  DiagnosticError: class extends Error { constructor(public readonly code: string, message: string) { super(message); } },
}));
vi.mock("@/features/diagnostic/diagnostic-runner", () => ({ DiagnosticRunner: () => null }));

import DiagnosticPage from "@/app/[locale]/(workspace)/diagnostics/[diagnosticId]/page";
import { DiagnosticRunner } from "@/features/diagnostic/diagnostic-runner";
import { DiagnosticError } from "@/server/diagnostic/service";

const id = "existing-diagnostic";
const page = () => DiagnosticPage({ params: Promise.resolve({ diagnosticId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockReset().mockResolvedValue({ user: { id: "signed-in-owner" } });
  mocks.diagnostic.mockReset();
});

describe("diagnostic route after submission", () => {
  it.each(["submitted", "scoring", "scoring_failed", "completed"])("opens the result instead of the runner for %s", async (status) => {
    mocks.diagnostic.mockResolvedValue({ diagnostic: { id, status } });
    await expect(page()).rejects.toThrow(`redirect:/ru/diagnostics/${id}/result`);
    expect(mocks.identity).toHaveBeenCalledTimes(1);
    expect(mocks.diagnostic).toHaveBeenCalledWith(id, "signed-in-owner");
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it.each(["published-v4", "retired-v3"])("retains the pinned %s runner for an in-progress diagnostic", async (versionId) => {
    const data = { diagnostic: { id, status: "in_progress", version_id: versionId }, blocks: [{ id: "pinned-block" }] };
    mocks.diagnostic.mockResolvedValue(data);
    const result = await page() as ReactElement<{ data: typeof data }>;
    expect(result.type).toBe(DiagnosticRunner);
    expect(result.props.data).toBe(data);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps an inaccessible or absent diagnostic as 404 before any result redirect", async () => {
    mocks.diagnostic.mockRejectedValue(new DiagnosticError("not_found", "Diagnostic not found"));
    await expect(page()).rejects.toThrow("not_found");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("requires identity before loading a diagnostic", async () => {
    mocks.identity.mockRejectedValue(new Error("redirect:/ru/login"));
    await expect(page()).rejects.toThrow("redirect:/ru/login");
    expect(mocks.diagnostic).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("preserves unexpected load errors", async () => {
    mocks.diagnostic.mockRejectedValue(new Error("database unavailable"));
    await expect(page()).rejects.toThrow("database unavailable");
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
