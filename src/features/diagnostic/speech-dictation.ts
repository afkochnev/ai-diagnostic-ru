interface SpeechResult extends ArrayLike<{ transcript: string }> {
  isFinal: boolean;
}

interface SpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechConstructor = new () => SpeechRecognition;
type SpeechWindow = Window & { SpeechRecognition?: SpeechConstructor; webkitSpeechRecognition?: SpeechConstructor };

export type SpeechUpdate =
  | { phase: "starting" | "listening" | "stopping"; transcript: string }
  | { phase: "finished"; transcript: string; message?: string };

export type SpeechCapture = { stop(): void; cancel(): void };

const startTimeoutMs = 8000;
const stopTimeoutMs = 5000;
let active: SpeechRecognition | null = null;

export function getSpeechRecognition(browser: SpeechWindow) {
  if (!browser.isSecureContext) return null;
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

function errorMessage(error: string) {
  switch (error) {
    case "not-allowed":
      return "Браузер не разрешил доступ к микрофону. Проверьте разрешения для этого сайта.";
    case "service-not-allowed":
      return "Браузер не разрешил использовать сервис распознавания речи.";
    case "audio-capture":
      return "Браузер не получил звук. Проверьте, подключён ли микрофон.";
    case "network":
      return "Сервис распознавания речи недоступен по сети. Проверьте подключение.";
    case "language-not-supported":
      return "Сервис браузера не поддерживает распознавание русской речи.";
    case "no-speech":
      return "Речь не распознана. Попробуйте ещё раз.";
    default:
      return "Браузер не смог запустить или завершить распознавание речи.";
  }
}

export function startSpeechDictation(Recognition: SpeechConstructor, report: (update: SpeechUpdate) => void): SpeechCapture | null {
  if (active) {
    report({ phase: "finished", transcript: "", message: "Сначала завершите диктовку в другом поле." });
    return null;
  }

  let recognition: SpeechRecognition;
  try {
    recognition = new Recognition();
  } catch {
    report({ phase: "finished", transcript: "", message: errorMessage("") });
    return null;
  }

  let transcript = "";
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  active = recognition;
  recognition.lang = "ru-RU";
  recognition.continuous = true;
  recognition.interimResults = false;

  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
  }

  function release() {
    if (active !== recognition) return false;
    clearTimer();
    active = null;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    return true;
  }

  function abort() {
    try {
      recognition.abort();
    } catch {
      // The browser may already have closed its session.
    }
  }

  function finish(message?: string, abortCapture = false) {
    if (!release()) return;
    if (abortCapture) abort();
    report({ phase: "finished", transcript, message });
  }

  recognition.onstart = () => {
    if (active !== recognition || stopping) return;
    clearTimer();
    report({ phase: "listening", transcript });
  };
  recognition.onresult = (event) => {
    if (active !== recognition) return;
    if (!stopping) clearTimer();
    transcript = Array.from(event.results)
      .filter((result) => result.isFinal)
      .map((result) => result[0]?.transcript.trim())
      .filter(Boolean)
      .join(" ");
    report({ phase: stopping ? "stopping" : "listening", transcript });
  };
  recognition.onerror = (event) => finish(errorMessage(event.error), true);
  recognition.onend = () => finish(transcript ? undefined : errorMessage("no-speech"));
  timer = setTimeout(() => finish("Браузер не запустил диктовку. Проверьте доступ к микрофону.", true), startTimeoutMs);
  report({ phase: "starting", transcript });
  try {
    recognition.start();
  } catch {
    finish(errorMessage(""), true);
    return null;
  }

  return {
    stop() {
      if (active !== recognition || stopping) return;
      stopping = true;
      clearTimer();
      timer = setTimeout(() => finish("Браузер не завершил распознавание вовремя.", true), stopTimeoutMs);
      report({ phase: "stopping", transcript });
      try {
        recognition.stop();
      } catch {
        finish(errorMessage(""), true);
      }
    },
    cancel() {
      if (release()) abort();
    },
  };
}

export function appendDictation(value: string, transcript: string) {
  const speech = transcript.trim();
  if (!speech) return value;
  return value + (value && !/\s$/.test(value) ? " " : "") + speech;
}
