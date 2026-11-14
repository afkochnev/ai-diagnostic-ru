import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, ServerMessage } from "@lichess-org/vosk-browser";
import { isLocalSpeechSupported, startLocalSpeechDictation } from "@/features/diagnostic/local-speech-dictation";
import type { SpeechCapture } from "@/features/diagnostic/speech-dictation";

class WorkerStub {
  static last: WorkerStub;
  onmessage?: (event: { data: ServerMessage }) => void;
  postMessage = vi.fn<(message: ClientMessage) => void>();
  terminate = vi.fn();

  constructor() { WorkerStub.last = this; }

  emit(data: ServerMessage) { this.onmessage?.({ data }); }
}

class AudioContextStub {
  static last: AudioContextStub;
  sampleRate = 48000;
  source = { connect: vi.fn(), disconnect: vi.fn() };
  createMediaStreamSource = vi.fn(() => this.source);
  destination = {};
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  worklet = { addModule: vi.fn(async () => undefined) };
  get audioWorklet() { return this.worklet; }

  constructor() { AudioContextStub.last = this; }
}

class AudioWorkletStub {
  static last: AudioWorkletStub;
  disconnect = vi.fn();
  connect = vi.fn();
  port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
  };

  constructor() { AudioWorkletStub.last = this; }

  emit(data: unknown) { this.port.onmessage?.({ data }); }
}

function mockMicrophone() {
  const track = { stop: vi.fn(), readyState: "live", onended: null };
  return { track, stream: { getAudioTracks: () => [track], getTracks: () => [track] } };
}

describe("on-device Russian dictation", () => {
  const update = vi.fn();
  const getUserMedia = vi.fn();
  const browser = {
    isSecureContext: true,
    location: { origin: "https://audit.example" },
    navigator: { mediaDevices: { getUserMedia } },
    Worker: WorkerStub,
    WebAssembly,
    indexedDB: {},
    AudioContext: AudioContextStub,
    AudioWorkletNode: AudioWorkletStub,
  };

  let session: SpeechCapture | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", browser);
    update.mockClear();
    getUserMedia.mockReset();
  });

  afterEach(() => {
    session?.cancel();
    session = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function listen() {
    const microphone = mockMicrophone();
    getUserMedia.mockResolvedValue(microphone.stream);
    session = startLocalSpeechDictation(update);
    WorkerStub.last.emit({ event: "load", result: true });
    await vi.advanceTimersByTimeAsync(0);
    return microphone;
  }

  it("detects support without invoking the microphone or loading the model", () => {
    expect(isLocalSpeechSupported(browser as unknown as Window)).toBe(true);
    expect(isLocalSpeechSupported({ ...browser, isSecureContext: false } as unknown as Window)).toBe(false);
    expect(isLocalSpeechSupported({ ...browser, AudioWorkletNode: undefined } as unknown as Window)).toBe(false);
    expect(isLocalSpeechSupported({ ...browser, indexedDB: undefined } as unknown as Window)).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("sends PCM to the same-origin worker, flushes the tail and waits for its final result", async () => {
    const { track } = await listen();
    const worker = WorkerStub.last;
    const worklet = AudioWorkletStub.last;
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(worker.postMessage).toHaveBeenCalledWith({
      action: "load",
      modelUrl: "https://audit.example/dictation/vosk-model-small-ru-0.22.tar.gz",
      wasmUrl: "https://audit.example/dictation/vosk.wasm",
    }, []);
    expect(AudioContextStub.last.worklet.addModule).toHaveBeenCalledWith("https://audit.example/dictation/pcm-worklet.js");
    expect(update).toHaveBeenLastCalledWith({ phase: "starting", transcript: "" });
    worklet.emit({ type: "audio", samples: Float32Array.of(0.5, -0.5) });
    expect(update).toHaveBeenLastCalledWith({ phase: "listening", transcript: "" });
    expect(worker.postMessage.mock.lastCall?.[0]).toEqual({
      action: "audioChunk", recognizerId: "dictation", data: Float32Array.of(16384, -16384), sampleRate: 48000,
    });

    session?.stop();
    expect(worklet.port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "flush" });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(worker.postMessage.mock.lastCall?.[0].action).toBe("audioChunk");
    worklet.emit({ type: "audio", samples: Float32Array.of(0.25) });
    worklet.emit({ type: "flushed" });
    expect(worker.postMessage.mock.lastCall?.[0].action).toBe("retrieveFinalResult");

    worker.emit({ event: "result", recognizerId: "dictation", result: { text: "Первый фрагмент", result: [] } });
    expect(update).toHaveBeenLastCalledWith({ phase: "stopping", transcript: "Первый фрагмент" });
    worker.emit({ event: "partialresult", recognizerId: "dictation", result: { partial: "второй", partial_result: [] } });
    expect(update).toHaveBeenLastCalledWith({ phase: "stopping", transcript: "Первый фрагмент второй" });
    worker.emit({ event: "result", recognizerId: "dictation", result: { text: "второй фрагмент", result: [] } });
    expect(update).toHaveBeenLastCalledWith({ phase: "finished", transcript: "Первый фрагмент второй фрагмент", message: undefined });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(AudioContextStub.last.close).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("releases a microphone granted after cancellation and rejects a concurrent session", async () => {
    const { track, stream } = mockMicrophone();
    const permission = Promise.withResolvers<typeof stream>();
    getUserMedia.mockReturnValue(permission.promise);
    session = startLocalSpeechDictation(update);
    const oldWorker = WorkerStub.last;
    const blocked = vi.fn();
    expect(startLocalSpeechDictation(blocked)).toBeNull();
    expect(blocked).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining("в другом поле") }));

    session?.cancel();
    permission.resolve(stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(oldWorker.terminate).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledExactlyOnceWith({ phase: "starting", transcript: "" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the recognizer when permission is denied", async () => {
    getUserMedia.mockRejectedValue(new DOMException("", "NotAllowedError"));
    session = startLocalSpeechDictation(update);
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenLastCalledWith({
      phase: "finished", transcript: "", message: expect.stringContaining("не разрешил доступ к микрофону"),
    });
    expect(WorkerStub.last.terminate).toHaveBeenCalledOnce();
  });

  it("keeps partial text if the worker stalls after stopping", async () => {
    await listen();
    AudioWorkletStub.last.emit({ type: "audio", samples: Float32Array.of(0.5) });
    WorkerStub.last.emit({ event: "partialresult", recognizerId: "dictation", result: { partial: "сохраняемый фрагмент", partial_result: [] } });
    session?.stop();
    AudioWorkletStub.last.emit({ type: "flushed" });
    await vi.advanceTimersByTimeAsync(8000);
    expect(update).toHaveBeenLastCalledWith({
      phase: "finished", transcript: "сохраняемый фрагмент", message: expect.stringContaining("не завершилось вовремя"),
    });
    expect(WorkerStub.last.terminate).toHaveBeenCalledOnce();
  });
});
