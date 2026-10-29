import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import type { ReactElement, ReactNode } from "react";
const h = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState(initial: unknown) { const i = h.cursor++; if (!(i in h.values)) h.values[i] = initial; return [h.values[i], (v: unknown) => { h.values[i] = v; }]; },
  useRef(initial: unknown) { const i = h.cursor++; if (!(i in h.values)) h.values[i] = { current: initial }; return h.values[i]; } }));
import { AdminIndividualPdf } from "@/features/pdf/admin-individual-pdf";
const id = "10000000-0000-4000-8000-000000000001", artifact = "30000000-0000-4000-8000-000000000001";
const ready = { report_id: id, ai_report_version: 2, artifact_id: artifact, status: "ready", template_version: "stage12-1i", checksum: "a".repeat(64), download_url: `/api/admin/report-artifacts/${artifact}` };
const f = vi.fn();
function render() { h.cursor = 0; return AdminIndividualPdf({ reportId: id, version: 2 }); }
function nodes(n: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => void; href?: string; disabled?: boolean }>[] { if (Array.isArray(n)) return n.flatMap(nodes); if (!React.isValidElement<{ children?: ReactNode; onClick?: () => void; href?: string; disabled?: boolean }>(n)) return []; return [n, ...nodes(n.props.children)]; }
const button = () => nodes(render()).find(n => n.type === "button")!;
beforeEach(() => { h.values = []; h.cursor = 0; f.mockReset(); vi.stubGlobal("React", React); vi.stubGlobal("fetch", f); });
afterEach(() => { vi.unstubAllGlobals(); });
async function notReady() { f.mockResolvedValueOnce(Response.json({ error: "pdf_not_ready" }, { status: 409 })); button().props.onClick!(); await vi.waitFor(() => expect(button().props.children).toBe("Подготовить PDF")); }
describe("explicit admin PDF controls", () => {
  it("viewing never starts status, preparation or AI", () => { expect(button().props.children).toBe("Проверить PDF"); expect(f).not.toHaveBeenCalled(); });
  it("not-ready status causes only GET, no automatic preparation", async () => { await notReady(); expect(f).toHaveBeenCalledExactlyOnceWith(`/api/admin/reports/${id}/pdf`, { cache: "no-store", redirect: "error" }); });
  it("double click gives one POST, then exposes only bound admin artifact download", async () => {
    await notReady(); let resolve!: (r: Response) => void; f.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
    const b = button(); b.props.onClick!(); b.props.onClick!(); expect(f).toHaveBeenCalledTimes(2); expect(button().props.disabled).toBe(true);
    resolve(Response.json(ready)); await vi.waitFor(() => expect(nodes(render()).some(n => n.type === "a")).toBe(true));
    expect(f.mock.calls[1]).toEqual([`/api/admin/reports/${id}/pdf/prepare`, { method: "POST", cache: "no-store", redirect: "error" }]);
    expect(nodes(render()).find(n => n.type === "a")?.props.href).toBe(ready.download_url); expect(nodes(render()).some(n => n.type === "button")).toBe(false);
  });
  it("ready status reuses existing artifact without any POST", async () => { f.mockResolvedValueOnce(Response.json(ready)); button().props.onClick!(); await vi.waitFor(() => expect(nodes(render()).some(n => n.type === "a")).toBe(true)); expect(f).toHaveBeenCalledOnce(); });
  it.each([{ ...ready, ai_report_version: 1 }, { ...ready, report_id: "other" }, { ...ready, template_version: "other" }, { ...ready, download_url: "https://evil.test/pdf" }, { ...ready, checksum: "bad" }])("wrong receipt binding fails closed with no retry", async response => {
    await notReady(); f.mockResolvedValueOnce(Response.json(response)); button().props.onClick!(); await vi.waitFor(() => expect(nodes(render()).some(n => n.type === "button")).toBe(false)); expect(nodes(render()).some(n => n.type === "a")).toBe(false); expect(f).toHaveBeenCalledTimes(2);
  });
  it.each(["network", "html", "conflict"])("%s after preparation produces stop state, no automatic retry", async scenario => {
    await notReady(); if (scenario === "network") f.mockRejectedValueOnce(Error("unknown")); else if (scenario === "html") f.mockResolvedValueOnce(new Response("<html>Login</html>")); else f.mockResolvedValueOnce(Response.json({ error: "pdf_integrity_failed" }, { status: 409 }));
    button().props.onClick!(); await vi.waitFor(() => expect(nodes(render()).some(n => n.type === "button")).toBe(false)); expect(f).toHaveBeenCalledTimes(2); expect(nodes(render()).some(n => n.type === "a")).toBe(false);
  });
});
