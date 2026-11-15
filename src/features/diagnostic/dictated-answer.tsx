"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type TextareaHTMLAttributes } from "react";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { isLocalSpeechSupported, startLocalSpeechDictation } from "./local-speech-dictation";
import { appendDictation, getSpeechRecognition, startSpeechDictation, type SpeechCapture, type SpeechUpdate } from "./speech-dictation";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "defaultValue" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
};

const subscribe = () => () => {};
type DictationMode = "local" | "browser" | "unavailable";
const serverMode = (): DictationMode => "unavailable";
const browserMode = (): DictationMode => {
  if (isLocalSpeechSupported(window)) return "local";
  return getSpeechRecognition(window) ? "browser" : "unavailable";
};
const buttonClass = "min-h-10 rounded-lg border border-line px-3 py-2 text-sm font-semibold";
const fallbackMessage = "В Windows поставьте курсор в поле ответа и нажмите Win + H. Если диктовка недоступна во встроенном браузере, попробуйте открыть эту страницу в Chrome.";
const localPrivacy = "Речь распознаётся на вашем устройстве. При первом запуске скачается модель русского языка (около 46 МБ). Сохраняется только вставленный текст.";
const browserPrivacy = "Браузер может передать звук своему сервису распознавания. Сохраняется только вставленный текст.";

export function DictatedAnswer({ value, onChange, disabled, maxLength, ...props }: Props) {
  const mode = useSyncExternalStore(subscribe, browserMode, serverMode);
  const [state, setState] = useState<SpeechUpdate | null>(null);
  const capture = useRef<SpeechCapture | null>(null);
  const answer = useRef<HTMLTextAreaElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const previewField = useRef<HTMLTextAreaElement>(null);
  const manageFocus = useRef(false);
  const privacyId = useId();
  const previewId = useId();

  useEffect(() => () => capture.current?.cancel(), []);
  useEffect(() => {
    if (disabled) capture.current?.stop();
  }, [disabled]);

  const pending = Boolean(state && state.phase !== "finished");
  const preview = state?.phase === "finished" && Boolean(state.transcript || !state.message);
  const result = appendDictation(value, state?.transcript ?? "");
  const tooLong = maxLength !== undefined && result.length > maxLength;

  useEffect(() => {
    if (!manageFocus.current || disabled || state?.phase !== "finished") return;
    manageFocus.current = false;
    if (document.activeElement !== document.body && !controls.current?.contains(document.activeElement)) return;
    if (preview) previewField.current?.focus();
    else startButton.current?.focus();
  }, [disabled, preview, state?.phase]);

  function start() {
    if (disabled || capture.current || pending || preview || mode === "unavailable") return;
    manageFocus.current = true;
    let finished = false;
    const report = (update: SpeechUpdate) => {
      finished = update.phase === "finished";
      if (finished) capture.current = null;
      setState(update);
    };
    const recognition = mode === "browser" ? getSpeechRecognition(window) : null;
    const session = mode === "local" ? startLocalSpeechDictation(report) : recognition && startSpeechDictation(recognition, report);
    if (!finished) capture.current = session;
  }

  function cancel() {
    capture.current?.cancel();
    capture.current = null;
    manageFocus.current = false;
    setState(null);
    answer.current?.focus();
  }

  function insert() {
    if (!preview || tooLong || result === value) return;
    onChange(result);
    cancel();
  }

  return <>
    <AutoResizeTextarea
      {...props}
      ref={answer}
      value={value}
      disabled={disabled}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
    />
    {mode === "unavailable" && <p className="mt-2 text-sm text-muted">В этом браузере кнопка диктовки недоступна. {fallbackMessage}</p>}
    {mode !== "unavailable" && <div ref={controls} className="mt-2 space-y-2">
      <button ref={startButton} type="button" disabled={disabled} aria-disabled={pending || preview || undefined} aria-describedby={privacyId} className={buttonClass + " aria-disabled:opacity-50"} onClick={start}>
        Диктовать ответ
      </button>
      <p id={privacyId} className="text-sm text-muted">{mode === "local" ? localPrivacy : browserPrivacy}</p>
      {state && <p role="status" aria-live="polite" className="text-sm text-muted">
        {speechStatus(state, mode)}
      </p>}
      {state?.phase === "finished" && state.message && <p className="text-sm text-muted">{fallbackMessage}</p>}
      {pending && <div className="flex flex-wrap items-center gap-2">
        {state?.phase === "listening" && <button type="button" disabled={disabled} className={buttonClass} onClick={() => capture.current?.stop()}>Остановить диктовку</button>}
        <button type="button" disabled={disabled} className={buttonClass} onClick={cancel}>Отменить</button>
      </div>}
      {preview && <div className="space-y-2">
        <label htmlFor={previewId} className="text-sm font-medium">Распознанный текст</label>
        <AutoResizeTextarea
          id={previewId}
          ref={previewField}
          disabled={disabled}
          className="rounded-lg border border-line p-2"
          rows={2}
          value={state.transcript}
          onChange={(event) => setState({ phase: "finished", transcript: event.target.value })}
        />
        {tooLong && <p role="status" className="text-sm text-muted">После вставки ответ превысит {maxLength} символов. Сократите распознанный текст.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled || tooLong || result === value} className={buttonClass} onClick={insert}>Добавить к ответу</button>
          <button type="button" disabled={disabled} className={buttonClass} onClick={cancel}>Отменить</button>
        </div>
      </div>}
    </div>}
  </>;
}

function speechStatus(state: SpeechUpdate, mode: DictationMode) {
  switch (state.phase) {
    case "starting":
      return mode === "local" ? "Подготавливаем распознавание. При запросе разрешите доступ к микрофону." : "Включаем микрофон…";
    case "listening":
      return "Идёт диктовка.";
    case "stopping":
      return "Завершаем распознавание…";
    case "finished":
      return state.message ?? "Проверьте распознанный текст перед вставкой.";
  }
}
