"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function TeamReportProgress({ createdAt, status }: { createdAt: string; status: "queued" | "generating" }) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const requestedAt = Date.parse(createdAt);
    const started = Number.isFinite(requestedAt) ? requestedAt : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [createdAt]);

  // Reads the existing owner page only. Never creates or retries a report.
  // Bound each observation window so a stalled job cannot poll indefinitely.
  useEffect(() => {
    const timeout = window.setTimeout(() => setPaused(true), 300_000);
    return () => window.clearTimeout(timeout);
  }, [cycle]);
  useEffect(() => {
    if (paused || pending) return;
    const timer = window.setInterval(() => startTransition(() => router.refresh()), 3000);
    return () => window.clearInterval(timer);
  }, [router, paused, pending, cycle]);

  return <div className="mt-3">
    <p role="status">{status === "queued" ? "Запрос принят. Ожидаем подготовки отчёта." : "Отчёт готовится."}</p>
    <p role="timer" aria-live="off" className="mt-3 font-medium tabular-nums">Прошло с запроса: {elapsed} сек.</p>
    <p className="mt-2 text-sm text-muted">{paused ? "Автоматическая проверка приостановлена. Обновите статус, чтобы продолжить ожидание." : "Готовый отчёт появится автоматически. Можно оставаться на этой странице."}</p>
    {elapsed >= 120 && !paused && <p className="mt-2 text-sm text-muted">Подготовка занимает больше времени. Продолжаем проверять статус.</p>}
    <button type="button" disabled={pending} onClick={() => {
      setPaused(false);
      setCycle(value => value + 1);
      startTransition(() => router.refresh());
    }} className="mt-3 rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-50">{pending ? "Проверяем…" : "Обновить статус"}</button>
  </div>;
}
