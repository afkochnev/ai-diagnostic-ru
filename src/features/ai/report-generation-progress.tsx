"use client";
import { useEffect, useState } from "react";

type ProgressState = "generating" | "completed" | "failed";

export function ReportGenerationProgress({ state, onClose }: { state: ProgressState; onClose?: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (state !== "generating") return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [state]);
  if (state === "failed") return <div role="dialog" aria-modal="true" aria-labelledby="report-generation-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-5"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><h2 id="report-generation-title" className="text-xl font-semibold">Формируем отчёт</h2><p role="alert" className="mt-3 text-sm text-red-700">Не удалось сформировать отчёт. Попробуйте ещё раз.</p>{onClose && <button type="button" onClick={onClose} className="mt-5 rounded-xl border border-line px-4 py-2 text-sm font-semibold">Закрыть</button>}</div></div>;
  return <div role="dialog" aria-modal="true" aria-labelledby="report-generation-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-5"><div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-xl"><h2 id="report-generation-title" className="text-xl font-semibold">Формируем отчёт</h2>{state === "completed" ? <p role="status" className="mt-3 text-sm text-muted">Отчёт готов.</p> : <><p className="mt-3 text-sm text-muted">Готовим отчёт о результатах диагностики.<br />Это займёт примерно 1–2 минуты.</p><p aria-hidden="true" className="mt-4 text-sm font-medium">Прошло: {elapsed} сек.</p><p className="mt-2 text-xs text-muted">Отчёт формируется в фоновом режиме.</p>{elapsed > 120 && <p role="status" className="mt-3 text-sm text-muted">Формирование занимает немного больше времени. Можно продолжить ожидание.</p>}</>}{onClose && state === "generating" && <button type="button" onClick={onClose} className="mt-5 rounded-xl border border-line px-4 py-2 text-sm font-semibold">Скрыть</button>}</div></div>;
}
