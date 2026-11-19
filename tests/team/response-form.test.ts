import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import type { ReactElement, ReactNode } from "react";
import { TeamResponseForm } from "@/features/team/response-form";
import { DictatedAnswer } from "@/features/diagnostic/dictated-answer";
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

const mocks = vi.hoisted(() => {
  const push = vi.fn(), refresh = vi.fn();
  return {fetch: vi.fn(), push, refresh, router: {push, refresh}};
});
vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(), ...hooks, useLayoutEffect: hooks.useEffect, useSyncExternalStore: (_subscribe: unknown, snapshot: () => boolean) => snapshot() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("next/link", () => ({ default: "a" }));

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
const requestBody = (index: number) => JSON.parse(mocks.fetch.mock.calls[index][1].body);
function button(tree: ReactNode, text: string) { return elements(tree).find((element) => element.type === "button" && element.props.children === text)!; }
function nextBlock(tree: ReactNode) {
  const preventDefault = vi.fn();
  (button(tree, "Далее").props.onClick as (event: { preventDefault: () => void }) => void)({ preventDefault });
  expect(preventDefault).toHaveBeenCalledExactlyOnceWith();
}
function choose(tree: ReactNode, value: number) {
  const scale = elements(tree).find((element) => element.props.name === "question-1" && typeof element.props.onChange === "function")!;
  (scale.props.onChange as (value: number) => void)(value);
}

beforeEach(() => {
  hooks.reset(); vi.useFakeTimers(); vi.stubGlobal("React", React);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
  mocks.fetch.mockReset().mockImplementation(async (_url, options) => {
    const { revision, submit } = JSON.parse(options.body);
    return Response.json({ revision: revision + 1, status: submit ? "completed" : "started" });
  });
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.push.mockReset(); mocks.refresh.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("team response blocks and saving", () => {
  it("hides obsolete profile advice in saved question hints without changing the answer", () => {
    const cached = { ...response, answers: { "question-2": "Saved goals" }, questions: [{ ...response.questions[1], help: "Укажите три главные цели. Если ответ перенесён из профиля, уточните его при необходимости." }] };
    const tree = hooks.render(() => TeamResponseForm({ response: cached }));
    expect(elements(tree).find((element) => element.props.id === "help-question-2")?.props.children).toBe("Укажите три главные цели.");
    expect(elements(tree).find((element) => element.type === DictatedAnswer)?.props.value).toBe("Saved goals");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not write on opening and saves every block using the latest revision", async () => {
    const tree = render();
    expect(button(tree, "Сохранить ответы")).toBeUndefined();
    expect(button(tree, "Повторить сохранение")).toBeUndefined();
    expect(elements(tree).some((element) => element.props.role === "status")).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.fetch).not.toHaveBeenCalled();
    choose(tree, 0);
    nextBlock(render());
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(requestBody(0).revision).toBe(4);
    const second = render();
    const textarea = elements(second).find((element) => element.type === DictatedAnswer)!;
    (textarea.props.onChange as (value: string) => void)("Current situation");
    render();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(requestBody(1).revision).toBe(5);
    expect(requestBody(1).answers).toEqual({ "question-1": 0, "question-2": "Current situation" });
  });

  it("preserves an edited draft and the original revision after a failed save", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: "Connection lost" }, { status: 400 }));
    choose(render(), 4); render();
    await vi.advanceTimersByTimeAsync(1500);
    const failed = render();
    const scale = elements(failed).find((element) => element.props.name === "question-1")!;
    expect(scale.props.value).toBe(4);
    expect(elements(failed).some((element) => element.props.role === "alert" && element.props.children === "Connection lost")).toBe(true);
    expect(elements(failed).some((element) => element.props.role === "status")).toBe(true);
    expect(button(failed, "Сохранить ответы")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    (button(failed, "Повторить сохранение").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(requestBody(1).revision).toBe(4);
    expect(requestBody(1).answers["question-1"]).toBe(4);
    const saved = render();
    expect(button(saved, "Повторить сохранение")).toBeUndefined();
    expect(elements(saved).some((element) => element.props.role === "status")).toBe(false);
  });

  it.each([401, 404])("keeps the draft after an account switch and verifies access before retrying (GET %s)", async status => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: "access_denied" }, { status: 403 }));
    choose(render(), 3);
    render();
    await vi.advanceTimersByTimeAsync(1500);
    choose(render(), 4);
    const blocked = render();
    const login = elements(blocked).find(element => element.type === "a" && element.props.target === "_blank")!;
    expect(login.props.href).toBe("/ru/login?method=email&next=%2Fru%2Fteam%2Fresponses%2Fparticipant-1");
    expect(elements(blocked).find(element => element.props.name === "question-1")?.props.value).toBe(4);
    expect(button(blocked, "Далее").props.disabled).toBe(true);
    nextBlock(blocked);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();

    mocks.fetch.mockResolvedValueOnce(Response.json({ error: "access_denied" }, { status }));
    (button(render(), "Я вошёл — повторить сохранение").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch.mock.calls[1][1].method).toBeUndefined();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);

    mocks.fetch.mockResolvedValueOnce(Response.json({ revision: 4, status: "started", answers: {} }));
    (button(render(), "Я вошёл — повторить сохранение").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch.mock.calls.map(([, options]) => options.method ?? "GET")).toEqual(["PATCH", "GET", "GET", "PATCH"]);
    expect(requestBody(3)).toEqual({ revision: 4, answers: { "question-1": 4, "question-2": "" }, submit: false });
    expect(button(render(), "Далее").props.disabled).toBe(false);
    expect(elements(render()).some(element => element.props.role === "alert")).toBe(false);
  });

  it("reconciles an earlier unconfirmed write after returning to the participant account", async () => {
    mocks.fetch.mockRejectedValueOnce(Error("connection interrupted"));
    choose(render(), 3);
    render();
    await vi.advanceTimersByTimeAsync(1500);
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: "access_denied" }, { status: 401 }));
    (button(render(), "Повторить сохранение").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    mocks.fetch.mockResolvedValueOnce(Response.json({ revision: 5, status: "started", answers: { "question-1": 3, "question-2": "" } }));
    (button(render(), "Я вошёл — повторить сохранение").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.fetch.mock.calls.map(([, options]) => options.method ?? "GET")).toEqual(["PATCH", "GET", "GET"]);
    expect(button(render(), "Далее").props.disabled).toBe(false);
  });

  it("requires an explicit final retry after the participant session is restored", async () => {
    const complete = { ...response, answers: { "question-1": 0, "question-2": "Current situation" } };
    const renderComplete = () => hooks.render(() => TeamResponseForm({ response: complete }));
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: "access_denied" }, { status: 401 }));
    const form = elements(renderComplete()).find(element => element.type === "form")!;
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
    await vi.advanceTimersByTimeAsync(0);
    renderComplete();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    mocks.fetch.mockResolvedValueOnce(Response.json({ revision: 4, status: "started", answers: complete.answers }));
    (button(renderComplete(), "Я вошёл — повторить отправку").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch.mock.calls.map(([, options]) => options.method ?? "GET")).toEqual(["PATCH", "GET", "PATCH"]);
    expect(requestBody(2).submit).toBe(true);
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/ru/team/responses/participant-1/result");
  });

  it("waits for Retry-After and then automatically saves the most recent draft", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: "Лимит сохранений" }, {
      status: 429, headers: { "Retry-After": "8" },
    }));
    choose(render(), 3);
    render();
    await vi.advanceTimersByTimeAsync(1500);

    choose(render(), 4);
    const waiting = render();
    expect(elements(waiting).find(element => element.props.name === "question-1")?.props.value).toBe(4);
    expect(elements(waiting).some(element => element.props.children === "Повторить сохранение можно через 8 сек.")).toBe(true);
    expect(button(waiting, "Далее").props.disabled).toBe(true);
    nextBlock(waiting);
    await vi.advanceTimersByTimeAsync(7900);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    render();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(requestBody(1)).toEqual({ revision: 4, answers: { "question-1": 4, "question-2": "" }, submit: false });
  });

  it("clears the save warning when a draft is reverted during the quota pause", async () => {
    const cached = {
      ...response,
      answers: { "question-1": 2 },
      questions: [response.questions[0], { ...response.questions[1], block_id: "block-1" }],
    };
    const renderCached = () => hooks.render(() => TeamResponseForm({ response: cached }));
    mocks.fetch.mockResolvedValueOnce(new Response("Busy", { status: 429, headers: { "Retry-After": "4" } }));

    choose(renderCached(), 3);
    renderCached();
    await vi.advanceTimersByTimeAsync(1500);
    choose(renderCached(), 2);
    renderCached();
    await vi.advanceTimersByTimeAsync(4000);
    renderCached();
    await vi.advanceTimersByTimeAsync(1500);
    const unchanged = renderCached();

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(elements(unchanged).some(element => element.props.role === "alert" || element.props.role === "status")).toBe(false);
  });

  it("waits for an explicit action before retrying a rate-limited final submission", async () => {
    const complete = { ...response, answers: { "question-1": 0, "question-2": "Current situation" } };
    const renderComplete = () => hooks.render(() => TeamResponseForm({ response: complete }));
    const submit = elements(renderComplete()).find(element => element.type === "form")!.props.onSubmit as
      (event: { preventDefault: () => void }) => void;
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: "Лимит сохранений", retryAfterSeconds: 4 }, { status: 429 }));

    submit({ preventDefault() {} });
    await vi.advanceTimersByTimeAsync(0);
    renderComplete();
    await vi.advanceTimersByTimeAsync(6000);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();

    const retry = button(renderComplete(), "Повторить отправку");
    expect(retry.props.disabled).toBe(false);
    (retry.props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(requestBody(1)).toMatchObject({ revision: 4, submit: true });
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/ru/team/responses/participant-1/result");
  });

  function hangUntilAbort(_url: string, options: RequestInit) {
    return new Promise<Response>((_, reject) => {
      options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    });
  }

  it("releases a blocked Next on timeout, retains the answer, and retries at the confirmed unchanged revision", async () => {
    mocks.fetch.mockImplementationOnce(hangUntilAbort);
    choose(render(), 4);
    nextBlock(render());
    await vi.advanceTimersByTimeAsync(0);
    expect(button(render(), "Далее").props.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    const failed = render();
    expect(button(failed, "Далее").props.disabled).toBe(false);
    expect(elements(failed).find(element => element.props.name === "question-1")?.props.value).toBe(4);
    mocks.fetch.mockResolvedValueOnce(Response.json({ revision: 4, status: "started", answers: {} }));
    (button(failed, "Повторить сохранение").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch.mock.calls[1][1].method).toBeUndefined();
    expect(requestBody(2)).toEqual({ revision: 4, answers: { "question-1": 4, "question-2": "" }, submit: false });
    expect(button(render(), "Повторить сохранение")).toBeUndefined();
  });

  it("recognizes a committed autosave with a lost response before saving a newer edit", async () => {
    mocks.fetch.mockRejectedValueOnce(Error("network failure"));
    choose(render(), 3);
    render();
    await vi.advanceTimersByTimeAsync(1500);
    mocks.fetch.mockResolvedValueOnce(Response.json({ revision: 5, status: "started", answers: { "question-2": "", "question-1": 3 } }));
    choose(render(), 4);
    render();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.fetch.mock.calls[1][1].method).toBeUndefined();
    expect(requestBody(2)).toEqual({ revision: 5, answers: { "question-1": 4, "question-2": "" }, submit: false });
    expect(button(render(), "Повторить сохранение")).toBeUndefined();
  });

  describe("final submission confirmation", () => {
    const complete = { ...response, answers: { "question-1": 0, "question-2": "Current situation" } };
    const renderComplete = () => hooks.render(() => TeamResponseForm({ response: complete }));
    const confirmation = () => Response.json({ revision: 5, status: "completed", answers: complete.answers });
    const methods = () => mocks.fetch.mock.calls.map(([, options]) => options.method ?? "GET");
    const submitComplete = () => {
      const form = elements(renderComplete()).find(element => element.type === "form")!;
      (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
    };

    it.each(["network failure", "server error", "non-JSON response", "unexpected result"])("confirms an already committed final submission automatically after %s", async failure => {
      if (failure === "network failure") mocks.fetch.mockRejectedValueOnce(Error("connection interrupted"));
      else if (failure === "server error") mocks.fetch.mockResolvedValueOnce(Response.json({ error: "save_unavailable" }, { status: 503 }));
      else if (failure === "non-JSON response") mocks.fetch.mockResolvedValueOnce(new Response("upstream unavailable", { status: 502 }));
      else mocks.fetch.mockResolvedValueOnce(Response.json({ revision: 4, status: "completed" }));
      mocks.fetch.mockResolvedValueOnce(confirmation());

      submitComplete();
      await vi.advanceTimersByTimeAsync(0);

      expect(methods()).toEqual(["PATCH", "GET"]);
      expect(requestBody(0)).toEqual({ revision: 4, answers: complete.answers, submit: true });
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/ru/team/responses/participant-1/result");
      expect(button(renderComplete(), "Повторить отправку")).toBeUndefined();
      expect(elements(renderComplete()).some(element => element.props.role === "alert")).toBe(false);
    });

    it("confirms a committed final submission after the request times out without another click", async () => {
      mocks.fetch.mockImplementationOnce(hangUntilAbort).mockResolvedValueOnce(confirmation());
      submitComplete();
      await vi.advanceTimersByTimeAsync(14_999);
      expect(methods()).toEqual(["PATCH"]);
      expect(button(renderComplete(), "Завершить участие").props.disabled).toBe(true);

      await vi.advanceTimersByTimeAsync(1);

      expect(methods()).toEqual(["PATCH", "GET"]);
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/ru/team/responses/participant-1/result");
      expect(button(renderComplete(), "Повторить отправку")).toBeUndefined();
    });

    it.each(["changed answers", "changed revision"])("keeps the draft and refuses to confirm a conflict with %s", async conflict => {
      mocks.fetch.mockRejectedValueOnce(Error("connection interrupted"));
      mocks.fetch.mockResolvedValueOnce(Response.json({
        revision: conflict === "changed revision" ? 6 : 5, status: "completed",
        answers: conflict === "changed answers" ? { ...complete.answers, "question-2": "Another tab's answer" } : complete.answers,
      }));
      submitComplete();
      await vi.advanceTimersByTimeAsync(0);

      const failed = renderComplete();
      expect(methods()).toEqual(["PATCH", "GET"]);
      expect(mocks.push).not.toHaveBeenCalled();
      expect(elements(failed).find(element => element.type === DictatedAnswer)?.props.value).toBe("Current situation");
      expect(elements(failed).some(element => element.props.role === "alert" && String(element.props.children).includes("другой вкладке"))).toBe(true);
    });

    it.each([401, 403, 404])("retains the draft and requests the participant session if automatic confirmation returns %s", async status => {
      mocks.fetch.mockRejectedValueOnce(Error("connection interrupted"));
      mocks.fetch.mockResolvedValueOnce(Response.json({ error: "access_denied" }, { status }));
      submitComplete();
      await vi.advanceTimersByTimeAsync(0);
      const blocked = renderComplete();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(methods()).toEqual(["PATCH", "GET"]);
      expect(mocks.push).not.toHaveBeenCalled();
      expect(button(blocked, "Завершить участие").props.disabled).toBe(true);
      expect(button(blocked, "Я вошёл — повторить отправку")).toBeDefined();
      expect(elements(blocked).find(element => element.type === DictatedAnswer)?.props.value).toBe("Current situation");
    });

    it.each(["unreachable", "unavailable", "not committed"])("stops after one read when confirmation is %s and retains the pending submission", async failure => {
      mocks.fetch.mockRejectedValueOnce(Error("connection interrupted"));
      if (failure === "unreachable") mocks.fetch.mockRejectedValueOnce(Error("still offline"));
      else if (failure === "unavailable") mocks.fetch.mockResolvedValueOnce(Response.json({ error: "status_unavailable" }, { status: 503 }));
      else mocks.fetch.mockResolvedValueOnce(Response.json({ revision: 4, status: "started", answers: complete.answers }));
      submitComplete();
      await vi.advanceTimersByTimeAsync(0);
      const failed = renderComplete();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(methods()).toEqual(["PATCH", "GET"]);
      expect(mocks.push).not.toHaveBeenCalled();
      expect(button(failed, "Повторить отправку")).toBeDefined();
      expect(elements(failed).find(element => element.type === DictatedAnswer)?.props.value).toBe("Current situation");

      mocks.fetch.mockResolvedValueOnce(confirmation());
      (button(failed, "Повторить отправку").props.onClick as () => void)();
      await vi.advanceTimersByTimeAsync(0);
      expect(methods()).toEqual(["PATCH", "GET", "GET"]);
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/ru/team/responses/participant-1/result");
    });

    it("ignores repeated Finish clicks while automatic confirmation is in progress", async () => {
      let resolveConfirmation!: (reply: Response) => void;
      mocks.fetch.mockRejectedValueOnce(Error("connection interrupted"));
      mocks.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveConfirmation = resolve; }));
      submitComplete();
      await vi.advanceTimersByTimeAsync(0);
      const confirming = renderComplete();
      expect(button(confirming, "Завершить участие").props.disabled).toBe(true);
      expect(elements(confirming).some(element => element.props.role === "status" && String(element.props.children).toLowerCase().includes("подтвержд"))).toBe(true);
      submitComplete();
      await vi.advanceTimersByTimeAsync(0);
      expect(methods()).toEqual(["PATCH", "GET"]);

      resolveConfirmation(confirmation());
      await vi.advanceTimersByTimeAsync(0);
      expect(methods()).toEqual(["PATCH", "GET"]);
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/ru/team/responses/participant-1/result");
    });
  });

  it("does not overwrite a different answer saved in another tab after an ambiguous response", async () => {
    mocks.fetch.mockRejectedValueOnce(Error("network failure"));
    choose(render(), 3);
    render();
    await vi.advanceTimersByTimeAsync(1500);
    mocks.fetch.mockResolvedValueOnce(Response.json({ revision: 5, status: "started", answers: { "question-1": 1, "question-2": "" } }));
    (button(render(), "Повторить сохранение").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const conflict = render();
    expect(elements(conflict).find(element => element.props.name === "question-1")?.props.value).toBe(3);
    expect(elements(conflict).some(element => element.props.role === "alert" && String(element.props.children).includes("другой вкладке"))).toBe(true);
  });

  it("reconciles when the original save commits after the first read and wins a retry conflict", async () => {
    mocks.fetch.mockRejectedValueOnce(Error("network failure"));
    choose(render(), 3);
    render();
    await vi.advanceTimersByTimeAsync(1500);
    mocks.fetch.mockResolvedValueOnce(Response.json({ revision: 4, status: "started", answers: {} }));
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: "Conflict" }, { status: 409 }));
    mocks.fetch.mockResolvedValueOnce(Response.json({ revision: 5, status: "started", answers: { "question-1": 3, "question-2": "" } }));
    (button(render(), "Повторить сохранение").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch.mock.calls.map(([, options]) => options.method ?? "GET")).toEqual(["PATCH", "GET", "PATCH", "GET"]);
    expect(requestBody(2).revision).toBe(4);
    expect(button(render(), "Повторить сохранение")).toBeUndefined();
  });

  it("saves a reversion that occurs while an earlier edit is still in flight", async () => {
    const cached = { ...response, answers: { "question-1": 1 } };
    const renderCached = () => hooks.render(() => TeamResponseForm({ response: cached }));
    (button(renderCached(), "Назад").props.onClick as () => void)();
    await vi.advanceTimersByTimeAsync(0);
    let finishSave!: (reply: Response) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finishSave = resolve; }));
    choose(renderCached(), 3);
    renderCached();
    await vi.advanceTimersByTimeAsync(1500);
    choose(renderCached(), 1);
    renderCached();
    finishSave(Response.json({ revision: 5, status: "started" }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(requestBody(1)).toEqual({ revision: 5, answers: { "question-1": 1, "question-2": "" }, submit: false });
  });

  it("saves partial answers when Next finds a required omission", async () => {
    const partial = { ...response, questions: [response.questions[0], { ...response.questions[1], block_id: "block-1" }, { ...response.questions[1], id: "question-3" }] };
    const tree = hooks.render(() => TeamResponseForm({ response: partial }));
    choose(tree, 0);
    const updated = hooks.render(() => TeamResponseForm({ response: partial }));
    nextBlock(updated);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(requestBody(0).answers["question-1"]).toBe(0);
    expect(elements(hooks.render(() => TeamResponseForm({ response: partial }))).some((element) => element.props.role === "alert")).toBe(true);
  });

  const withClosingQuestions: TeamResponse = {
    ...response,
    questions: [response.questions[0], ...[1, 2, 3].map(index => ({
      ...response.questions[1], id: `closing-${index}`, prompt: `Closing question ${index}`, required: false,
    }))],
  };

  it("scrolls only after the requested block is rendered, without moving on autosave", async () => {
    const heading = { scrollIntoView: vi.fn(), focus: vi.fn() };
    const initial = render();
    const headingRef = elements(initial).find(element => element.type === "h2")!.props.ref as { current: unknown };
    headingRef.current = heading;
    expect(heading.scrollIntoView).not.toHaveBeenCalled();

    choose(initial, 2);
    render();
    await vi.advanceTimersByTimeAsync(1500);
    const saved = render();
    expect(heading.scrollIntoView).not.toHaveBeenCalled();

    nextBlock(saved);
    await vi.advanceTimersByTimeAsync(0);
    expect(heading.scrollIntoView).not.toHaveBeenCalled();
    const next = render();
    expect(heading.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: "auto", block: "start" });
    expect(heading.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });

    const answer = elements(next).find(element => element.type === DictatedAnswer)!;
    (answer.props.onChange as (value: string) => void)("A saved answer");
    render();
    await vi.advanceTimersByTimeAsync(1500);
    render();
    expect(heading.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("keeps all closing questions open after Next when the required answers are already autosaved", async () => {
    const renderClosing = () => hooks.render(() => TeamResponseForm({ response: withClosingQuestions }));
    choose(renderClosing(), 2);
    renderClosing();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(requestBody(0).submit).toBe(false);

    const previous = renderClosing();
    nextBlock(previous);
    await vi.advanceTimersByTimeAsync(0);
    const closing = renderClosing();
    const textareas = elements(closing).filter(element => element.type === DictatedAnswer);
    expect(textareas.map(element => element.props.name)).toEqual(["closing-1", "closing-2", "closing-3"]);
    expect(button(closing, "Завершить участие").key).not.toBe(button(previous, "Далее").key);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();

    textareas.forEach((element, index) => {
      (element.props.onChange as (value: string) => void)(`Closing answer ${index + 1}`);
    });
    const form = elements(renderClosing()).find(element => element.type === "form")!;
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(requestBody(1)).toEqual({
      revision: 5, submit: true,
      answers: { "question-1": 2, "closing-1": "Closing answer 1", "closing-2": "Closing answer 2", "closing-3": "Closing answer 3" },
    });
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/ru/team/responses/participant-1/result");
  });

  it("ignores implicit submission before the closing block even when every required answer is saved", async () => {
    const renderClosing = () => hooks.render(() => TeamResponseForm({ response: withClosingQuestions }));
    choose(renderClosing(), 3);
    renderClosing();
    await vi.advanceTimersByTimeAsync(1500);
    const beforeClosing = renderClosing();
    const preventDefault = vi.fn();
    const form = elements(beforeClosing).find(element => element.type === "form")!;
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault });
    await vi.advanceTimersByTimeAsync(0);

    expect(preventDefault).toHaveBeenCalledExactlyOnceWith();
    expect(button(renderClosing(), "Далее")).toBeDefined();
    expect(button(renderClosing(), "Завершить участие")).toBeUndefined();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(requestBody(0).submit).toBe(false);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("sends submit once and opens the personal result after completion", async () => {
    const complete = { ...response, answers: { "question-1": 0, "question-2": "Current situation" } };
    const renderComplete = () => hooks.render(() => TeamResponseForm({ response: complete }));
    mocks.fetch.mockResolvedValueOnce(Response.json({ revision: 5, status: "completed" }));
    const form = elements(renderComplete()).find((element) => element.type === "form")!;
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(requestBody(0).submit).toBe(true);
    expect(mocks.push).toHaveBeenCalledWith("/ru/team/responses/participant-1/result");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
