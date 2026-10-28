"use client";

import { useEffect, useRef, useState } from "react";

type Status = "missing" | "failed" | "queued" | "generating" | "completed";
export function AdminReportRegeneration({ diagnosticId, initialStatus }: { diagnosticId: string; initialStatus: Status }) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const endpoint = `/api/admin/diagnostics/${diagnosticId}/reports`;
  const pending = status === "queued" || status === "generating";
  useEffect(() => {
    if (!pending) return;
    let active = true;
    let reading = false;
    const timer = setInterval(async () => {
      if (reading) return;
      reading = true;
      try {
        const response = await fetch(endpoint, { method: "GET", cache: "no-store" });
        const body = await response.json();
        if (!active) return;
        if (!response.ok || !["queued", "generating", "completed", "failed"].includes(body.status)) { setError(true); return; }
        setStatus(body.status);
        setError(body.status === "failed");
        if (body.status === "completed") window.location.reload();
      } catch { if (active) setError(true); }
      finally { reading = false; }
    }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [endpoint, pending]);

  async function request() {
    if (inFlight.current || pending) return;
    inFlight.current = true; setBusy(true); setError(false);
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !["queued", "generating", "completed"].includes(body.status)) throw new Error("unavailable");
      setStatus(body.status);
      if (body.status === "completed") window.location.reload();
    } catch { setError(true); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="mt-4 space-y-2">
    {pending ? <p role="status">AI-отчёт готовится.</p> : <button type="button" disabled={busy} onClick={() => void request()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">{busy ? "Запрашиваем отчёт…" : status === "failed" ? "Повторить формирование AI-отчёта" : status === "missing" ? "Сформировать AI-отчёт" : "Сформировать новую версию"}</button>}
    {error && <p role="alert" className="text-sm text-red-700">Не удалось подготовить отчёт. Обновите страницу для проверки статуса.</p>}
  </div>;
}
