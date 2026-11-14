import { beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => update.mockClear());

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
  });

  it("handles a permission refusal and allows a fresh attempt", () => {
    startSpeechDictation(SpeechStub, update);
    SpeechStub.last.onerror?.({ error: "not-allowed" });
    expect(update).toHaveBeenLastCalledWith({ phase: "finished", transcript: "", message: expect.stringContaining("не разрешил") });
    const next = startSpeechDictation(SpeechStub, update);
    expect(next).not.toBeNull();
    next?.cancel();
  });

  it("handles a network failure and keeps finalized fragments available for review", () => {
    startSpeechDictation(SpeechStub, update);
    SpeechStub.last.recognize(["Первая часть", true]);
    SpeechStub.last.onerror?.({ error: "network" });
    expect(update).toHaveBeenLastCalledWith({ phase: "finished", transcript: "Первая часть", message: expect.stringContaining("недоступна") });
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
