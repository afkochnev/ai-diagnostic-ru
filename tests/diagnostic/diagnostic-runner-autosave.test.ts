import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import type { ReactElement, ReactNode } from "react";
import type { DiagnosticPageData } from "@/server/diagnostic/service";
import { DiagnosticRunner } from "@/features/diagnostic/diagnostic-runner";

// Exercise the runner's event handlers and effects without a live app or database.
// The project uses a Node test environment, so retain hook state across renders.
const hooks = vi.hoisted(() => {
  type Slot = { value?: unknown; dependencies?: unknown[]; cleanup?: () => void };
  let slots: Slot[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const same = (left: unknown[] | undefined, right: unknown[]) => left?.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const slot = () => slots[cursor++] ?? (slots[cursor - 1] = {});
  const memo = <T,>(factory: () => T, dependencies: unknown[]) => {
    const current = slot();
    if (!same(current.dependencies, dependencies)) {
      current.value = factory();
      current.dependencies = dependencies;
    }
    return current.value as T;
  };
  return {
    reset() { slots = []; cursor = 0; effects = []; },
    render<T>(component: () => T) {
      cursor = 0; effects = [];
      const tree = component();
      for (const effect of effects) effect();
      return tree;
    },
    useState<T>(initial: T) {
      const current = slot();
      if (!("value" in current)) current.value = initial;
      return [current.value, (next: T | ((value: T) => T)) => { current.value = typeof next === "function" ? (next as (value: T) => T)(current.value as T) : next; }] as const;
    },
    useRef<T>(initial: T) {
      const current = slot();
      if (!("value" in current)) current.value = { current: initial };
      return current.value as { current: T };
    },
    useMemo: memo,
    useCallback<T>(callback: T, dependencies: unknown[]) { return memo(() => callback, dependencies); },
    useEffect(effect: () => void | (() => void), dependencies: unknown[]) {
      const current = slot();
      if (same(current.dependencies, dependencies)) return;
      current.dependencies = dependencies;
      effects.push(() => { current.cleanup?.(); current.cleanup = effect() || undefined; });
    },
  };
});

vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(), ...hooks }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: "a" }));

const data = {
  diagnostic: { id: "existing-diagnostic", revision: 7, current_block_id: "block-1" },
  company: { name: "Existing company" },
  blocks: [
    { id: "block-1", title: "First block", questions: [{ id: "question-1", prompt: "Existing answer", answer_type: "scale_0_4", is_required: true, answer: { numeric_value: 2, text_value: null } }] },
    { id: "block-2", title: "Second block", questions: [] },
  ],
} as unknown as DiagnosticPageData;

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

const render = () => hooks.render(() => DiagnosticRunner({ data }));
function edit(tree: ReactNode, value: number) {
  const question = elements(tree).find((element) => element.props.question);
  (question?.props.onChange as (value: number) => void)(value);
}

describe("diagnostic runner autosave", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    hooks.reset();
    vi.useFakeTimers();
    // Supports the classic JSX transform used by the Node test environment.
    vi.stubGlobal("React", React);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ revision: 8 }) });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("does not write when opening an existing answered diagnostic", async () => {
    render();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("autosaves an actual answer edit after the debounce", async () => {
    edit(render(), 3);
    render();
    await vi.advanceTimersByTimeAsync(899);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/diagnostics/existing-diagnostic/answers");
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body)).toMatchObject({ expected_revision: 7, answers_dirty: true, answers: [{ question_id: "question-1", value: 3 }] });
  });

  it("does not autosave a click on the already persisted answer", async () => {
    edit(render(), 2);
    render();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels autosave when an edit is reverted before the debounce", async () => {
    edit(render(), 3);
    const changed = render();
    await vi.advanceTimersByTimeAsync(400);
    edit(changed, 2);
    render();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps explicit block navigation save without a second autosave", async () => {
    const next = elements(render()).find((element) => element.type === "button" && element.props.children === "Далее");
    (next?.props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    render();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ current_block_id: "block-2", answers_dirty: false, answers: [] });
  });

  it("keeps the explicit save and submit sequence", async () => {
    const finalBlockData = { ...data, diagnostic: { ...data.diagnostic, current_block_id: "block-2" } };
    const tree = hooks.render(() => DiagnosticRunner({ data: finalBlockData }));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ revision: 8 }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    const submit = elements(tree).find((element) => element.type === "button" && element.props.children === "Завершить диагностику");
    (submit?.props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
      ["/api/diagnostics/existing-diagnostic/answers", "PATCH"],
      ["/api/diagnostics/existing-diagnostic/submit", "POST"],
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ expected_revision: 8 });
  });
});
