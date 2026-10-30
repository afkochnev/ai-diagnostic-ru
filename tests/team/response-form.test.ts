import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import type { ReactElement, ReactNode } from "react";
import { TeamResponseForm } from "@/features/team/response-form";
import type { TeamResponse } from "@/server/team/contracts";

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

const mocks = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(), ...hooks, useSyncExternalStore: (_subscribe: unknown, snapshot: () => boolean) => snapshot() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/server/team/actions", () => ({ saveTeamResponseAction: mocks.save }));

const response = {
  participant_id: "participant-1", title: "Team", display_name: "Participant", revision: 4, status: "started", answers: {},
  questions: [
    { id: "question-1", block_id: "block-1", block_title: "First block", prompt: "First score", answer_type: "scale_0_4", required: true, help: null, options: [] },
    { id: "question-2", block_id: "block-2", block_title: "Second block", prompt: "Second answer", answer_type: "text", required: true, help: null, options: [] },
  ],
} as TeamResponse;

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
const render = () => hooks.render(() => TeamResponseForm({ response }));
function button(tree: ReactNode, text: string) { return elements(tree).find((element) => element.type === "button" && element.props.children === text)!; }
function choose(tree: ReactNode, value: number) {
  const scale = elements(tree).find((element) => element.props.name === "question-1" && typeof element.props.onChange === "function")!;
  (scale.props.onChange as (value: number) => void)(value);
}

beforeEach(() => {
  hooks.reset(); vi.useFakeTimers(); vi.stubGlobal("React", React);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
  mocks.save.mockReset().mockImplementation(async (previous) => ({ revision: previous.revision + 1, status: "started" }));
  mocks.push.mockReset(); mocks.refresh.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("team response blocks and saving", () => {
  it("does not write on opening and saves every block using the latest revision", async () => {
    const tree = render();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.save).not.toHaveBeenCalled();
    choose(tree, 0);
    (button(render(), "Далее").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][1].get("revision")).toBe("4");
    const second = render();
    const textarea = elements(second).find((element) => element.type === "textarea")!;
    (textarea.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Current situation" } });
    render();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][1].get("revision")).toBe("5");
    expect(JSON.parse(mocks.save.mock.calls[1][1].get("answers"))).toEqual({ "question-1": 0, "question-2": "Current situation" });
  });

  it("preserves an edited draft and the original revision after a failed save", async () => {
    mocks.save.mockResolvedValueOnce({ revision: 4, status: "started", error: "Connection lost" });
    choose(render(), 4); render();
    await vi.advanceTimersByTimeAsync(1500);
    const failed = render();
    const scale = elements(failed).find((element) => element.props.name === "question-1")!;
    expect(scale.props.value).toBe(4);
    expect(elements(failed).some((element) => element.props.role === "alert" && element.props.children === "Connection lost")).toBe(true);
    (button(failed, "Сохранить ответы").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.save.mock.calls[1][1].get("revision")).toBe("4");
    expect(JSON.parse(mocks.save.mock.calls[1][1].get("answers"))["question-1"]).toBe(4);
  });

  it("saves partial answers when Next finds a required omission", async () => {
    const partial = { ...response, questions: [response.questions[0], { ...response.questions[1], block_id: "block-1" }, { ...response.questions[1], id: "question-3" }] };
    const tree = hooks.render(() => TeamResponseForm({ response: partial }));
    choose(tree, 0);
    const updated = hooks.render(() => TeamResponseForm({ response: partial }));
    (button(updated, "Далее").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.save.mock.calls[0][1].get("answers"))["question-1"]).toBe(0);
    expect(elements(hooks.render(() => TeamResponseForm({ response: partial }))).some((element) => element.props.role === "alert")).toBe(true);
  });

  it("sends submit once and opens the personal result after completion", async () => {
    const complete = { ...response, answers: { "question-1": 0, "question-2": "Current situation" } };
    const renderComplete = () => hooks.render(() => TeamResponseForm({ response: complete }));
    mocks.save.mockResolvedValueOnce({ revision: 5, status: "completed" });
    const form = elements(renderComplete()).find((element) => element.type === "form")!;
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][1].get("intent")).toBe("submit");
    expect(mocks.push).toHaveBeenCalledWith("/ru/team/responses/participant-1/result");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
