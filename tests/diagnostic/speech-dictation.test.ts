import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendDictation, getSpeechRecognition, startSpeechDictation } from "@/features/diagnostic/speech-dictation";

type BrowserSpeech = InstanceType<NonNullable<ReturnType<typeof getSpeechRecognition>>>;

class SpeechStub implements BrowserSpeech {
  static last: SpeechStub;
  lang = "";
  continuous = false;
  interimResults = true;
  onstart: BrowserSpeech["onstart"] = null;
  onend: BrowserSpeech["onend"] = null;
  onerror: BrowserSpeech["onerror"] = null;
  onresult: BrowserSpeech["onresult"] = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn();
  abort = vi.fn();

  constructor() { SpeechStub.last = this; }

  recognize(...transcripts: Array<[string, boolean]>) {
    this.onresult?.({
      results: transcripts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })),
    });
  }
}

describe("Russian browser dictation", () => {
  const update = vi.fn();
  beforeEach(() => {
    update.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("requires a secure supported browser and uses the prefixed implementation when needed", () => {
    const browser = (secure: boolean, vendor = {}) => ({ isSecureContext: secure, ...vendor }) as Window;
    expect(getSpeechRecognition(browser(true))).toBeNull();
    expect(getSpeechRecognition(browser(false, { SpeechRecognition: SpeechStub }))).toBeNull();
    expect(getSpeechRecognition(browser(true, { webkitSpeechRecognition: SpeechStub }))).toBe(SpeechStub);
    expect(getSpeechRecognition(browser(true, { SpeechRecognition: SpeechStub }))).toBe(SpeechStub);
  });

  it("captures only final fragments in Russian and accepts the last result after stopping", () => {
    const session = startSpeechDictation(SpeechStub, update);
    const speech = SpeechStub.last;
    expect(speech.lang).toBe("ru-RU");
    expect(speech.start).toHaveBeenCalledOnce();

    speech.recognize([" Первый фрагмент ", true], ["черновик", false]);
    expect(update).toHaveBeenLastCalledWith({ phase: "listening", transcript: "Первый фрагмент" });
    session?.stop();
    session?.stop();
    expect(speech.stop).toHaveBeenCalledOnce();
    speech.recognize([" Первый фрагмент ", true], ["второй", true]);
    speech.onend?.();

    expect(update).toHaveBeenLastCalledWith({ phase: "finished", transcript: "Первый фрагмент второй" });
    expect(vi.getTimerCount()).toBe(0);
    expect(speech.abort).not.toHaveBeenCalled();
  });

  it("handles a permission refusal and allows a fresh attempt", () => {
    startSpeechDictation(SpeechStub, update);
    SpeechStub.last.onerror?.({ error: "not-allowed" });
    expect(update).toHaveBeenLastCalledWith({ phase: "finished", transcript: "", message: expect.stringContaining("доступ к микрофону") });
    const next = startSpeechDictation(SpeechStub, update);
    expect(next).not.toBeNull();
    next?.cancel();
  });

  it("handles a network failure and keeps finalized fragments available for review", () => {
    startSpeechDictation(SpeechStub, update);
    SpeechStub.last.recognize(["Первая часть", true]);
    SpeechStub.last.onerror?.({ error: "network" });
    expect(update).toHaveBeenLastCalledWith({ phase: "finished", transcript: "Первая часть", message: expect.stringContaining("недоступен по сети") });
  });

  it.each([
    ["service-not-allowed", "не разрешил использовать сервис"],
    ["language-not-supported", "не поддерживает распознавание русской речи"],
  ])("gives an actionable message for %s", (error, detail) => {
    startSpeechDictation(SpeechStub, update);
    SpeechStub.last.onerror?.({ error });
    expect(update).toHaveBeenLastCalledWith({ phase: "finished", transcript: "", message: expect.stringContaining(detail) });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a silent startup and ignores browser events arriving after timeout", () => {
    class SilentSpeech extends SpeechStub { start = vi.fn(); }
    const session = startSpeechDictation(SilentSpeech, update);
    const staleStart = SpeechStub.last.onstart;
    const staleError = SpeechStub.last.onerror;
    const silent = SpeechStub.last;
    vi.advanceTimersByTime(7999);
    expect(update).toHaveBeenLastCalledWith({ phase: "starting", transcript: "" });
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenLastCalledWith({ phase: "finished", transcript: "", message: expect.stringContaining("не запустил диктовку") });
    expect(silent.abort).toHaveBeenCalledOnce();

    const retry = startSpeechDictation(SpeechStub, update);
    const count = update.mock.calls.length;
    staleStart?.();
    staleError?.({ error: "not-allowed" });
    session?.cancel();
    expect(update).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
    retry?.cancel();
  });

  it("clears the startup timeout when listening and retains the last final text after a silent stop", () => {
    const session = startSpeechDictation(SpeechStub, update);
    const speech = SpeechStub.last;
    vi.advanceTimersByTime(9000);
    expect(update).toHaveBeenLastCalledWith({ phase: "listening", transcript: "" });
    speech.recognize(["Начало", true]);
    session?.stop();
    vi.advanceTimersByTime(4999);
    speech.recognize(["Начало", true], ["окончание", true]);
    expect(update).toHaveBeenLastCalledWith({ phase: "stopping", transcript: "Начало окончание" });
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenLastCalledWith({ phase: "finished", transcript: "Начало окончание", message: expect.stringContaining("не завершил распознавание вовремя") });
    expect(speech.abort).toHaveBeenCalledOnce();
  });

  it("does not report timeout after cancellation while the browser is starting", () => {
    class SilentSpeech extends SpeechStub { start = vi.fn(); }
    const session = startSpeechDictation(SilentSpeech, update);
    session?.cancel();
    vi.advanceTimersByTime(9000);
    expect(update).toHaveBeenCalledExactlyOnceWith({ phase: "starting", transcript: "" });
    expect(SpeechStub.last.abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("blocks parallel recording and drops late events after cancellation or navigation", () => {
    const session = startSpeechDictation(SpeechStub, update);
    const old = SpeechStub.last;
    const lateResult = old.onresult;
    const lateEnd = old.onend;
    const parallel = vi.fn();
    expect(startSpeechDictation(SpeechStub, parallel)).toBeNull();
    expect(parallel).toHaveBeenCalledWith({ phase: "finished", transcript: "", message: expect.stringContaining("в другом поле") });

    session?.cancel();
    expect(old.abort).toHaveBeenCalledOnce();

    const next = startSpeechDictation(SpeechStub, update);
    const nextUpdate = update.mock.calls.length;
    lateResult?.({ results: [Object.assign([{ transcript: "Старый вопрос" }], { isFinal: true })] });
    lateEnd?.();
    expect(update).toHaveBeenCalledTimes(nextUpdate);
    next?.cancel();
  });

  it("appends a reviewed transcript without replacing the typed answer or its whitespace", () => {
    expect(appendDictation("Существующий текст.", " Новый текст ")).toBe("Существующий текст. Новый текст");
    expect(appendDictation("Существующий текст.\n", "Новый текст")).toBe("Существующий текст.\nНовый текст");
    expect(appendDictation("Существующий текст.", "  ")).toBe("Существующий текст.");
  });
});
