"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startStatusPolling } from "@/shared/status-polling";

const scoringStatuses = ["queued", "scoring", "scoring_failed", "completed"];

export function ResultPoller({ diagnosticId, status }: { diagnosticId: string; status: string }) {
  const router = useRouter();
  const [view, setView] = useState<"waiting" | "unavailable" | "paused" | "failed">(
    status === "scoring_failed" ? "failed" : "waiting",
  );
  const [checks, setChecks] = useState(0);

  useEffect(() => {
    return startStatusPolling(`/api/diagnostics/${diagnosticId}/score`, {
      delayMs: 1000,
      acceptedStatuses: scoringStatuses,
      onStatus({ status: current }) {
        if (current === "completed") {
          router.refresh();
          return true;
        }
        if (current === "scoring_failed") {
          setView("failed");
          return false;
        }
        setView("waiting");
        return false;
      },
      onUnavailable: () => setView("unavailable"),
      onPause: () => setView("paused"),
    });
  }, [diagnosticId, checks, router]);

  return <main className="mx-auto min-h-[60vh] max-w-2xl px-5 py-16">
    <h1 className="text-3xl font-semibold">{view === "failed" ? "Не удалось рассчитать результаты" : "Рассчитываем результаты"}</h1>
    <p role="status" className="mt-4 text-muted">
      {view === "failed" && "Проверяем, возобновился ли расчёт. Можно обновить статус вручную."}
      {view === "waiting" && "Расчёт выполняется на сервере. Результаты появятся автоматически."}
      {view === "unavailable" && "Не удалось связаться с сервером. Проверим статус ещё раз."}
      {view === "paused" && "Автоматическая проверка приостановлена. Обновите статус, чтобы снова проверить результаты."}
    </p>
    {view !== "waiting" && <button type="button" onClick={() => {
      setView("waiting");
      setChecks(value => value + 1);
    }} className="mt-6 rounded-xl bg-brand px-5 py-3 font-semibold text-white">Обновить статус</button>}
  </main>;
}
