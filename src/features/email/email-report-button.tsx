"use client";
import { useState } from "react";
export function EmailReportButton({ reportId }: { reportId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  async function send() {
    if (state === "sending") return;
    setState("sending");
    try { const response = await fetch(`/api/reports/${reportId}/email`, { method: "POST", cache: "no-store" }); if (!response.ok) throw new Error("email_failed"); setState("sent"); } catch { setState("failed"); }
  }
  return <div className="mt-3">{state === "sent" ? <p role="status" className="py-2 text-sm text-muted">✓ Отчёт отправлен на email</p> : <button type="button" onClick={() => void send()} disabled={state === "sending"} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border border-brand bg-transparent px-5 py-3 text-center font-semibold text-brand disabled:opacity-60">{state === "sending" ? "Отправляем…" : "Отправить на email"}</button>}{state === "failed" && <p role="alert" className="mt-2 text-sm text-red-700">Не удалось отправить отчёт. Попробуйте ещё раз.</p>}</div>;
}
