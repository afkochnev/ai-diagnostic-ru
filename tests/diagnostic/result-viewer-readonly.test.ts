import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import type { ReactElement, ReactNode } from "react";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void | (() => void))[] }));
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = next; }];
  },
  useEffect(effect: () => void | (() => void)) { hooks.effects.push(effect); },
}));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

import { ResultPoller } from "@/features/diagnostic/result-poller";
import { AIReportSection } from "@/features/ai/ai-report-section";
import { ReportRegenerationButton } from "@/features/ai/report-regeneration-button";

function render<T>(component: () => T) {
  hooks.cursor = 0;
  hooks.effects = [];
  return component();
}
function elements(node: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => void }>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function click(tree: ReactNode, label: string) {
  const button = elements(tree).find((element) => element.type === "button" && element.props.children === label);
  expect(button).toBeDefined();
  button!.props.onClick!();
}

describe("result viewer passive requests", () => {
  const fetchMock = vi.fn();
  const reload = vi.fn();
  let cleanups: (() => void)[] = [];
  function mountEffects() {
    for (const effect of hooks.effects) {
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    }
  }
  beforeEach(() => {
    hooks.values = [];
    hooks.cursor = 0;
    hooks.effects = [];
    cleanups = [];
    fetchMock.mockReset();
    navigation.refresh.mockReset();
    reload.mockReset();
    vi.useFakeTimers();
    vi.stubGlobal("React", React);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { reload } });
  });
  afterEach(() => {
    cleanups.forEach((cleanup) => cleanup());
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("only reads scoring status while waiting for a submitted diagnostic", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ status: "queued" }, { status: 202 }));
    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed" }));
    render(() => ResultPoller({ diagnosticId: "existing", status: "submitted" }));
    mountEffects();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock.mock.calls).toEqual([
      ["/api/diagnostics/existing/score", { method: "GET", cache: "no-store" }],
      ["/api/diagnostics/existing/score", { method: "GET", cache: "no-store" }],
    ]);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("updates failed scoring status with a read instead of claiming to retry calculation", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "scoring_failed" }, { status: 202 }));
    const tree = render(() => ResultPoller({ diagnosticId: "existing", status: "scoring_failed" }));
    click(tree, "Обновить статус");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/diagnostics/existing/score", { method: "GET", cache: "no-store" });
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it.each([null, { status: "queued" }, { status: "generating" }])("only reads pending AI status on opening (%j)", async (initial) => {
    fetchMock.mockResolvedValueOnce(Response.json({ status: "generating" }));
    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed" }));
    render(() => AIReportSection({ diagnosticId: "existing", initial }));
    mountEffects();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock.mock.calls).toEqual([
      ["/api/diagnostics/existing/ai", { method: "GET", cache: "no-store" }],
      ["/api/diagnostics/existing/ai", { method: "GET", cache: "no-store" }],
    ]);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps a slow existing AI job pending beyond ninety seconds",async()=>{
    fetchMock.mockImplementation(async()=>Response.json({status:"generating"}));
    const component=()=>AIReportSection({diagnosticId:"existing",initial:{status:"generating"}});
    render(component);mountEffects();
    await vi.advanceTimersByTimeAsync(100_000);
    const tree=render(component);
    expect(elements(tree).some(node=>node.props.children==="Готовим аналитический AI-отчёт")).toBe(true);
    expect(elements(tree).some(node=>node.props.children==="Не удалось подготовить AI-отчёт")).toBe(false);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(60);
    expect(fetchMock.mock.calls.every(call=>call[1].method==="GET")).toBe(true);
  });

  it("distinguishes a failed status read and retries only the read",async()=>{
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(Response.json({status:"generating"}));
    const initial={status:"generating"};const component=()=>AIReportSection({diagnosticId:"existing",initial});
    render(component);mountEffects();await vi.advanceTimersByTimeAsync(0);
    let tree=render(component);
    expect(elements(tree).some(node=>node.props.children==="Сейчас не удалось проверить готовность. Это не означает, что подготовка отчёта остановилась.")).toBe(true);
    click(tree,"Проверить статус");tree=render(component);mountEffects();await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(call=>call[1].method==="GET")).toBe(true);
  });

  it("shows a real server failure without automatically creating a report",async()=>{
    fetchMock.mockResolvedValue(Response.json({status:"failed"}));
    const initial={status:"generating"};const component=()=>AIReportSection({diagnosticId:"existing",initial});
    render(component);mountEffects();await vi.advanceTimersByTimeAsync(0);
    const tree=render(component);
    expect(elements(tree).some(node=>node.props.children==="Не удалось подготовить AI-отчёт")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it.each(["completed", "failed"])("does not poll a terminal AI report (%s)", (status) => {
    render(() => AIReportSection({ diagnosticId: "existing", initial: { status, structured_content: {} } }));
    mountEffects();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only creates a new report on explicit request and uses GET to monitor it", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ status: "queued" }, { status: 202 }));
    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed" }));
    const component = () => ReportRegenerationButton({ diagnosticId: "existing" });
    const tree = render(component);
    mountEffects();
    expect(fetchMock).not.toHaveBeenCalled();
    click(tree, "Сформировать новый отчёт");
    await vi.advanceTimersByTimeAsync(0);
    render(component);
    mountEffects();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock.mock.calls).toEqual([
      ["/api/diagnostics/existing/reports", { method: "POST", cache: "no-store" }],
      ["/api/diagnostics/existing/ai", { method: "GET", cache: "no-store" }],
    ]);
    expect(reload).toHaveBeenCalledOnce();
  });
});
