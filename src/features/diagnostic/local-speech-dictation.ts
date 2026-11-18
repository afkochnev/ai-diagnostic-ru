import type { ClientMessage, ServerMessage } from "@lichess-org/vosk-browser";
import type { SpeechCapture, SpeechUpdate } from "./speech-dictation";

const startTimeoutMs = 90000;
const audioTimeoutMs = 6000;
const stopTimeoutMs = 8000;
const maxQueuedChunks = 128;
const maxBufferedSeconds = 90;
const maxBufferedBytes = 32 * 1024 * 1024;
const recognizerId = "dictation";
const assetPath = "/dictation/";

type Browser = Window & typeof globalThis;
type Phase = "starting" | "listening" | "stopping";
type WorkletMessage =
  | { type: "audio"; samples: Float32Array }
  | { type: "flushed" };

let active: symbol | null = null;

export function isLocalSpeechSupported(browser: Window): boolean {
  const platform = browser as Browser;
  return browser.isSecureContext
    && typeof platform.WebAssembly === "object"
    && typeof platform.indexedDB !== "undefined"
    && typeof platform.Worker === "function"
    && typeof platform.AudioContext === "function"
    && "audioWorklet" in platform.AudioContext.prototype
    && typeof platform.AudioWorkletNode === "function"
    && typeof platform.navigator.mediaDevices?.getUserMedia === "function";
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Браузер не разрешил доступ к микрофону. Проверьте разрешения для этого сайта.";
      case "NotFoundError":
        return "Микрофон не найден. Проверьте, подключён ли он.";
      case "NotReadableError":
        return "Не удалось получить звук. Проверьте микрофон и настройки устройства.";
    }
  }
  return "Не удалось включить микрофон.";
}

export function startLocalSpeechDictation(report: (update: SpeechUpdate) => void): SpeechCapture | null {
  if (active || !isLocalSpeechSupported(window)) {
    report({
      phase: "finished",
      transcript: "",
      message: active ? "Сначала завершите диктовку в другом поле." : "Локальная диктовка недоступна в этом браузере.",
    });
    return null;
  }

  const session = Symbol();
  active = session;
  let phase: Phase = "starting";
  let audioTimer: ReturnType<typeof setTimeout> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let context: AudioContext | undefined;
  let worker: Worker | undefined;
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let input: AudioWorkletNode | undefined;
  let inputReady = false;
  let modelReady = false;
  let recognizerReady = false;
  let flushed = false;
  let finalRequested = false;
  let outstanding = 0;
  const queuedAudio: Float32Array[] = [];
  let queuedSamples = 0;
  const fragments: string[] = [];
  let partial = "";

  const assetUrl = (name: string) => new URL(assetPath + name, window.location.origin).href;
  const isActive = () => active === session;
  const transcript = () => [...fragments, partial].filter(Boolean).join(" ");

  function stopMicrophone() {
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stream = undefined;
  }

  function release(): boolean {
    if (!isActive()) return false;
    active = null;
    clearTimeout(preparationTimer);
    clearTimeout(audioTimer);
    clearTimeout(stopTimer);
    queuedAudio.length = 0;
    queuedSamples = 0;
    if (input) {
      input.port.onmessage = null;
      input.port.close();
      input.onprocessorerror = null;
      input.disconnect();
    }
    source?.disconnect();
    stopMicrophone();
    if (context) void context.close().catch(() => undefined);
    worker?.terminate();
    return true;
  }

  function finish(message?: string) {
    if (release()) report({ phase: "finished", transcript: transcript(), message });
  }

  function waitForRecognition() {
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => finish("Распознавание не завершилось вовремя."), stopTimeoutMs);
  }

  function publish() {
    report({ phase, transcript: transcript() });
  }

  function post(message: ClientMessage, transfer: Transferable[] = []) {
    worker?.postMessage(message, transfer);
  }

  function drainAudio() {
    if (!isActive() || !recognizerReady || !context) return;
    while (queuedAudio.length && outstanding < maxQueuedChunks) {
      const data = queuedAudio.shift()!;
      queuedSamples -= data.length;
      outstanding += 1;
      post({ action: "audioChunk", recognizerId, data, sampleRate: context.sampleRate }, [data.buffer]);
    }
    if (flushed && !queuedAudio.length && outstanding === 0 && !finalRequested) {
      finalRequested = true;
      waitForRecognition();
      post({ action: "retrieveFinalResult", recognizerId });
    }
  }

  function acceptAudio(message: WorkletMessage) {
    if (!isActive() || !context) return;
    if (message.type === "flushed") {
      if (phase === "stopping") {
        flushed = true;
        drainAudio();
      }
      return;
    }
    if (flushed || finalRequested || !(message.samples instanceof Float32Array)) return;
    clearTimeout(audioTimer);
    if (phase === "starting") {
      phase = "listening";
      publish();
    }
    // The microphone is already recording while the model loads. Retain the
    // beginning in memory rather than connecting the input only after loading.
    const sampleLimit = Math.min(context.sampleRate * maxBufferedSeconds, maxBufferedBytes / Float32Array.BYTES_PER_ELEMENT);
    if (queuedSamples + message.samples.length > sampleLimit) {
      finish("Устройство не успевает распознавать речь. Попробуйте диктовать короткими фрагментами.");
      return;
    }
    const data = Float32Array.from(message.samples, (sample) => sample * 32768);
    queuedAudio.push(data);
    queuedSamples += data.length;
    drainAudio();
  }

  function startRecognizerWhenReady() {
    if (!isActive() || !modelReady || !input || !context || recognizerReady) return;
    post({ action: "create", recognizerId, sampleRate: context.sampleRate });
    recognizerReady = true;
    clearTimeout(preparationTimer);
    if (phase === "stopping") waitForRecognition();
    drainAudio();
  }

  function startCaptureWhenReady() {
    if (!isActive() || !inputReady || !context || !stream || input) return;
    try {
      source = context.createMediaStreamSource(stream);
      input = new window.AudioWorkletNode(context, "dictation-pcm", {
        channelCount: 1,
        channelCountMode: "explicit",
        outputChannelCount: [1],
      });
      input.port.onmessage = (event: MessageEvent<WorkletMessage>) => acceptAudio(event.data);
      input.onprocessorerror = () => finish("Браузер прервал обработку звука с микрофона.");
      input.connect(context.destination);
      source.connect(input);
      audioTimer = setTimeout(() => finish("Не удалось получить звук с микрофона. Проверьте настройки устройства."), audioTimeoutMs);
      startRecognizerWhenReady();
    } catch {
      finish("Браузер не смог начать обработку звука с микрофона.");
    }
  }

  function receive(message: ServerMessage) {
    if (!isActive() || !message) return;
    if (message.event === "load") {
      if (!message.result) finish("Не удалось загрузить русскую модель распознавания.");
      else {
        modelReady = true;
        startRecognizerWhenReady();
      }
      return;
    }
    if (message.event === "error") {
      finish(modelReady ? "Локальное распознавание прервалось." : "Не удалось загрузить русскую модель распознавания.");
      return;
    }
    if (message.recognizerId !== recognizerId) return;
    // This worker sends exactly one response per audio chunk, in order. Its
    // final-result response uses the same event as a recognized chunk.
    const isFinalResponse = finalRequested && outstanding === 0;
    if (outstanding > 0) outstanding -= 1;
    if (message.event === "partialresult") partial = message.result.partial.trim();
    else {
      const text = message.result.text?.trim();
      if (text) fragments.push(text);
      partial = "";
    }
    if (isFinalResponse) finish(transcript() ? undefined : "Речь не распознана. Попробуйте ещё раз.");
    else {
      if (phase === "stopping" && recognizerReady) waitForRecognition();
      drainAudio();
      publish();
    }
  }

  publish();
  const preparationTimer = setTimeout(() => finish("Не удалось подготовить диктовку. Проверьте разрешение на микрофон и загрузку модели."), startTimeoutMs);
  async function prepareMicrophone() {
    let recording: MediaStream;
    try {
      recording = await window.navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      finish(microphoneError(error));
      return false;
    }
    if (!isActive()) {
      recording.getTracks().forEach((track) => track.stop());
      return false;
    }

    stream = recording;
    const microphone = stream.getAudioTracks()[0];
    if (!microphone || microphone.readyState !== "live") {
      finish("Микрофон не найден. Проверьте, подключён ли он.");
      return false;
    }
    microphone.onended = () => finish("Микрофон отключился во время диктовки.");
    return true;
  }

  try {
    context = new window.AudioContext();
    worker = new window.Worker(assetUrl("vosk.worker.js"), { type: "module" });
    worker.onmessage = (event: MessageEvent<ServerMessage>) => receive(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      finish("Браузер не смог запустить локальное распознавание.");
    };
    worker.onmessageerror = () => finish("Локальное распознавание прервалось.");
    post({ action: "set", key: "logLevel", value: -2 });
    post({
      action: "load",
      modelUrl: assetUrl("vosk-model-small-ru-0.22.tar.gz"),
      wasmUrl: assetUrl("vosk.wasm"),
    });
    void Promise.all([prepareMicrophone(), context.resume(), context.audioWorklet.addModule(assetUrl("pcm-worklet.js"))])
      .then(([microphoneReady]) => {
        if (!microphoneReady || !isActive()) return;
        inputReady = true;
        startCaptureWhenReady();
      })
      .catch(() => finish("Браузер не смог подготовить микрофон для диктовки."));
  } catch {
    finish("Браузер не смог запустить локальное распознавание.");
    return null;
  }

  return {
    stop() {
      if (!isActive() || phase === "stopping") return;
      if (!input) {
        finish("Диктовка остановлена до начала записи.");
        return;
      }
      phase = "stopping";
      publish();
      // If the model is still loading, keep its preparation deadline. Once
      // ready, drain every recorded chunk before asking for the final result.
      if (recognizerReady) waitForRecognition();
      input.port.postMessage({ type: "flush" });
      stopMicrophone();
    },
    cancel() {
      release();
    },
  };
}
