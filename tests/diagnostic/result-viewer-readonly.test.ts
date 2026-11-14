import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import type { ReactElement, ReactNode } from "react";

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void | (() => void))[],
  dependencies: [] as unknown[][],
  effectCursor: 0,
  cleanups: [] as Array<(() => void) | void>,
}));
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (next: unknown) => {
      hooks.values[index] = typeof next === "function" ? next(hooks.values[index]) : next;
    }];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useEffect(effect: () => void | (() => void), dependencies: unknown[]) {
    const index = hooks.effectCursor++;
    const old = hooks.dependencies[index];
    if (old?.length === dependencies.length && old.every((value, i) => Object.is(value, dependencies[i]))) return;
    hooks.dependencies[index] = dependencies;
    hooks.effects.push(() => {
      hooks.cleanups[index]?.();
      hooks.cleanups[index] = effect();
    });
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

import { ResultPoller } from "@/features/diagnostic/result-poller";
import { AIReportSection } from "@/features/ai/ai-report-section";
import { ReportRegenerationButton } from "@/features/ai/report-regeneration-button";

function render<T>(component: () => T) {
  hooks.cursor = 0;
  hooks.effectCursor = 0;
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
  function mountEffects() {
    for (const effect of hooks.effects) effect();
  }
  beforeEach(() => {
    hooks.values = [];
    hooks.cursor = 0;
    hooks.effects = [];
    hooks.dependencies = [];
    hooks.cleanups = [];
    fetchMock.mockReset();
    navigation.refresh.mockReset();
    vi.useFakeTimers();
    vi.stubGlobal("React", React);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    hooks.cleanups.forEach((cleanup) => cleanup?.());
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
      ["/api/diagnostics/existing/score", { method: "GET", cache: "no-store", signal: expect.any(AbortSignal) }],
      ["/api/diagnostics/existing/score", { method: "GET", cache: "no-store", signal: expect.any(AbortSignal) }],
    ]);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("updates failed scoring status with a read instead of claiming to retry calculation", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "scoring_failed" }, { status: 202 }));
    const tree = render(() => ResultPoller({ diagnosticId: "existing", status: "scoring_failed" }));
    click(tree, "Обновить статус");
    render(() => ResultPoller({ diagnosticId: "existing", status: "scoring_failed" }));
    mountEffects();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/diagnostics/existing/score", { method: "GET", cache: "no-store", signal: expect.any(AbortSignal) });
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it.each([null, { status: "queued" }, { status: "generating" }])("only reads pending AI status on opening (%j)", async (initial) => {
    fetchMock.mockResolvedValueOnce(Response.json({ status: "generating" }));
    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed" }));
    render(() => AIReportSection({ diagnosticId: "existing", initial }));
    mountEffects();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock.mock.calls).toEqual([
      ["/api/diagnostics/existing/ai", { method: "GET", cache: "no-store", signal: expect.any(AbortSignal) }],
      ["/api/diagnostics/existing/ai", { method: "GET", cache: "no-store", signal: expect.any(AbortSignal) }],
    ]);
    expect(navigation.refresh).toHaveBeenCalledOnce();
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
    expect(elements(tree).some(node=>node.props.children==="Не удалось проверить готовность отчёта. Проверим статус ещё раз.")).toBe(true);
    click(tree,"Проверить статус");tree=render(component);mountEffects();await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(call=>call[1].method==="GET")).toBe(true);
  });

  it("retries a network rejection and displays the scoring result on completion", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed" }));
    const component = () => ResultPoller({ diagnosticId: "existing", status: "submitted" });
    render(component); mountEffects();
    await vi.advanceTimersByTimeAsync(0);
    expect(elements(render(component)).some(node => Array.isArray(node.props.children) && node.props.children.includes("Не удалось связаться с сервером. Проверим статус ещё раз."))).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("aborts a hung read before retrying and disposes pending reads on unmount", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url, { signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    render(() => AIReportSection({ diagnosticId: "existing", initial: null })); mountEffects();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(3_001);
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    hooks.cleanups.forEach(cleanup => cleanup?.());
    expect(signals[1].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(signals).toHaveLength(2);
  });

  it("pauses a long AI wait without treating it as a generation failure", async () => {
    fetchMock.mockImplementation(async () => Response.json({ status: "generating" }));
    const component = () => AIReportSection({ diagnosticId: "existing", initial: null });
    render(component); mountEffects();
    await vi.advanceTimersByTimeAsync(300_000);
    const lastCount = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(lastCount);
    const tree = render(component); mountEffects();
    expect(elements(tree).some(node => node.props.children === "Автоматическая проверка приостановлена. Проверьте статус, чтобы продолжить ожидание.")).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed" }));
    click(tree, "Проверить статус");
    render(component); mountEffects();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(lastCount + 1);
    expect(navigation.refresh).toHaveBeenCalledOnce();
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

  it("checks a lost regeneration response without mistaking the earlier report for the new one", async () => {
    fetchMock.mockRejectedValueOnce(new Error("lost acknowledgment"));
    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed", version: 1 }));
    const component = () => ReportRegenerationButton({ diagnosticId: "existing", currentVersion: 1 });
    const tree = render(component); mountEffects();
    click(tree, "Сформировать новый отчёт");
    await vi.advanceTimersByTimeAsync(0);
    const waiting = render(component); mountEffects();
    await vi.advanceTimersByTimeAsync(0);
    expect(navigation.refresh).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed", version: 2 }));
    click(waiting, "Проверить статус");
    render(component); mountEffects();
    await vi.advanceTimersByTimeAsync(0);
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(["POST", "GET", "GET"]);
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
      ["/api/diagnostics/existing/reports", { method: "POST", cache: "no-store", signal: expect.any(AbortSignal) }],
      ["/api/diagnostics/existing/ai", { method: "GET", cache: "no-store", signal: expect.any(AbortSignal) }],
    ]);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
});
