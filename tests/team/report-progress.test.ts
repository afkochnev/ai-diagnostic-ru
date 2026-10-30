import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import type { ReactElement, ReactNode } from "react";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void | (() => void))[], pending: false }));
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (next: unknown) => {
      hooks.values[index] = typeof next === "function" ? next(hooks.values[index]) : next;
    }];
  },
  useEffect(effect: () => void | (() => void)) { hooks.effects.push(effect); },
  useTransition: () => [hooks.pending, (work: () => void) => work()],
}));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
import { TeamReportProgress } from "@/features/team/report-progress";

function render(createdAt = "2026-10-18T10:00:00Z", status: "queued" | "generating" = "queued") {
  hooks.cursor = 0;
  hooks.effects = [];
  return TeamReportProgress({ createdAt, status });
}
function nodes(node: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => void; role?: string }>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement<{ children?: ReactNode; onClick?: () => void; role?: string }>(node)) return [];
  return [node, ...nodes(node.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

describe("Team report waiting status", () => {
  let cleanups: (() => void)[];
  const fetchMock = vi.fn();
  function mount() { for (const effect of hooks.effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } }
  function unmount() { cleanups.forEach(fn => fn()); cleanups = []; }
  beforeEach(() => {
    hooks.values = []; hooks.cursor = 0; hooks.effects = []; hooks.pending = false;
    cleanups = []; navigation.refresh.mockReset(); fetchMock.mockReset();
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T10:01:24Z"));
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("counts from the server request time, including time before opening the page", () => {
    render(); mount();
    expect(text(render())).toContain("Подготовка отчёта займёт от 1 до 2 минут.");
    expect(text(render())).toContain("Прошло с запроса: 84 сек.");
    vi.advanceTimersByTime(2000);
    expect(text(render())).toContain("Прошло с запроса: 86 сек.");
  });
  it.each(["queued", "generating"] as const)("refreshes the owner page for %s, without creating/retrying a report", status => {
    render(undefined, status); mount();
    vi.advanceTimersByTime(3000);
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    unmount(); vi.advanceTimersByTime(6000);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
  it("does not start another refresh while a transition is pending", () => {
    hooks.pending = true; render(); mount(); vi.advanceTimersByTime(6000);
    expect(navigation.refresh).not.toHaveBeenCalled();
  });
  it("shows a delay message without pretending that elapsed seconds are server progress", () => {
    render("2026-10-18T09:58:00Z"); mount();
    expect(text(render())).toContain("Подготовка занимает больше времени");
    expect(nodes(render()).find(n => n.props.role === "timer")).toBeDefined();
    expect(text(render())).not.toContain("%");
  });
  it("pauses automatic checking after five minutes and resumes only after a read-only click", () => {
    render(); mount(); vi.advanceTimersByTime(300_000);
    expect(text(render())).toContain("Автоматическая проверка приостановлена");
    unmount(); render(); mount();
    const calls = navigation.refresh.mock.calls.length;
    vi.advanceTimersByTime(6000);
    expect(navigation.refresh).toHaveBeenCalledTimes(calls);
    nodes(render()).find(n => n.type === "button")!.props.onClick!();
    expect(navigation.refresh).toHaveBeenCalledTimes(calls + 1);
    expect(text(render())).toContain("Готовый отчёт появится автоматически");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["invalid", "2026-10-18T11:00:00Z"])("handles an invalid or future timestamp (%s)", createdAt => {
    render(createdAt); mount();
    expect(text(render(createdAt))).toContain("Прошло с запроса: 0 сек.");
  });
});
