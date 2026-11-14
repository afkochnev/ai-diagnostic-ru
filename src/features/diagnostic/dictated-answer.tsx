"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type TextareaHTMLAttributes } from "react";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { appendDictation, getSpeechRecognition, startSpeechDictation, type SpeechCapture, type SpeechUpdate } from "./speech-dictation";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "defaultValue" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
};

const subscribe = () => () => {};
const serverSupported = () => false;
const browserSupported = () => Boolean(getSpeechRecognition(window));
const buttonClass = "min-h-10 rounded-lg border border-line px-3 py-2 text-sm font-semibold";
const pendingMessages = {
  starting: "Включаем микрофон…",
  listening: "Идёт диктовка.",
  stopping: "Завершаем распознавание…",
};

export function DictatedAnswer({ value, onChange, disabled, maxLength, ...props }: Props) {
  const supported = useSyncExternalStore(subscribe, browserSupported, serverSupported);
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
    if (disabled || capture.current || pending || preview) return;
    const recognition = getSpeechRecognition(window);
    if (!recognition) return;
    manageFocus.current = true;
    let finished = false;
    const session = startSpeechDictation(recognition, (update) => {
      finished = update.phase === "finished";
      if (finished) capture.current = null;
      setState(update);
    });
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
    {supported && <div ref={controls} className="mt-2 space-y-2">
      <button ref={startButton} type="button" disabled={disabled} aria-disabled={pending || preview || undefined} aria-describedby={privacyId} className={buttonClass + " aria-disabled:opacity-50"} onClick={start}>
        Диктовать ответ
      </button>
      <p id={privacyId} className="text-sm text-muted">Браузер может передать звук своему сервису распознавания. В диагностике сохраняется только вставленный текст.</p>
      {state && <p role="status" aria-live="polite" className="text-sm text-muted">
        {state.phase === "finished" ? state.message ?? "Проверьте распознанный текст перед вставкой." : pendingMessages[state.phase]}
      </p>}
      {pending && <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={disabled || state?.phase !== "listening"} className={buttonClass} onClick={() => capture.current?.stop()}>Остановить диктовку</button>
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
