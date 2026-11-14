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

let active: SpeechRecognition | null = null;

export function getSpeechRecognition(browser: SpeechWindow) {
  if (!browser.isSecureContext) return null;
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

function errorMessage(error: string) {
  if (error === "not-allowed" || error === "service-not-allowed") return "Браузер не разрешил диктовку. Проверьте настройки микрофона или введите ответ вручную.";
  if (error === "audio-capture") return "Браузер не получил звук с микрофона. Проверьте подключение или введите ответ вручную.";
  if (error === "no-speech") return "Речь не распознана. Попробуйте ещё раз или введите ответ вручную.";
  return "Диктовка недоступна. Повторите попытку или введите ответ вручную.";
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
  active = recognition;
  recognition.lang = "ru-RU";
  recognition.continuous = true;
  recognition.interimResults = false;

  function release() {
    if (active !== recognition) return false;
    active = null;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    return true;
  }

  function finish(message?: string) {
    if (release()) report({ phase: "finished", transcript, message });
  }

  recognition.onstart = () => {
    if (active === recognition && !stopping) report({ phase: "listening", transcript });
  };
  recognition.onresult = (event) => {
    if (active !== recognition) return;
    transcript = Array.from(event.results)
      .filter((result) => result.isFinal)
      .map((result) => result[0]?.transcript.trim())
      .filter(Boolean)
      .join(" ");
    report({ phase: stopping ? "stopping" : "listening", transcript });
  };
  recognition.onerror = (event) => finish(errorMessage(event.error));
  recognition.onend = () => finish(transcript ? undefined : errorMessage("no-speech"));
  report({ phase: "starting", transcript });
  try {
    recognition.start();
  } catch {
    finish(errorMessage(""));
    return null;
  }

  return {
    stop() {
      if (active !== recognition || stopping) return;
      stopping = true;
      report({ phase: "stopping", transcript });
      try {
        recognition.stop();
      } catch {
        finish(errorMessage(""));
        try {
          recognition.abort();
        } catch {
          // The browser has already closed or invalidated the session.
        }
      }
    },
    cancel() {
      if (!release()) return;
      try {
        recognition.abort();
      } catch {
        // A browser may already have closed its session.
      }
    },
  };
}

export function appendDictation(value: string, transcript: string) {
  const speech = transcript.trim();
  if (!speech) return value;
  return value + (value && !/\s$/.test(value) ? " " : "") + speech;
}
