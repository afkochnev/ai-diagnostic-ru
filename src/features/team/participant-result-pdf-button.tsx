"use client";
import { useState } from "react";

export function ParticipantResultPdfButton({ participantId }: { participantId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    if (pending) return;
    setPending(true); setError(null);
    let url: string | undefined;
    try {
      const response = await fetch(`/api/team/responses/${participantId}/result/pdf`, { cache: "no-store" });
      if (response.status === 401) throw new Error("session_expired");
      if (response.status === 429) throw new Error("rate_limited");
      if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) throw new Error("pdf_failed");
      url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "team-diagnostic-my-result.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      const downloadUrl = url;
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      url = undefined;
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "session_expired" ? "Сессия завершилась. Войдите снова, чтобы скачать свой результат." : code === "rate_limited" ? "Подождите минуту перед повторным скачиванием." : "Не удалось скачать PDF. Попробуйте ещё раз.");
    } finally {
      if (url) URL.revokeObjectURL(url);
      setPending(false);
    }
  }
  return <div className="mt-6">
    <button type="button" disabled={pending} onClick={() => void download()} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-60 sm:w-auto">{pending ? "Готовим PDF…" : "Скачать PDF"}</button>
    {pending && <p role="status" className="mt-2 text-sm text-muted">Подготавливаем файл с вашими оценками.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}
