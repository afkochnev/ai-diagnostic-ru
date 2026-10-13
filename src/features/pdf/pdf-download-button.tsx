"use client";
import { useState } from "react";

export function PdfDownloadButton({ reportId }: { reportId: string }) {
  const [action, setAction] = useState<"idle" | "download" | "prepare">("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsPreparation, setNeedsPreparation] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  async function download() {
    if (action !== "idle") return;
    setAction("download"); setError(null); setStatus(null);
    try {
      const response = await fetch(`/api/reports/${reportId}/pdf`, { cache: "no-store" });
      if (response.status === 409) {
        setNeedsPreparation(true);
        setError("PDF ещё не готов. Нажмите «Подготовить PDF», затем скачайте его.");
        return;
      }
      if (!response.ok) throw new Error("pdf_failed");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url;
      const disposition = response.headers.get("content-disposition");
      const match = disposition?.match(/filename="?([^";]+)"?/i);
      link.download = match?.[1] ?? "management-ai-audit.pdf";
      link.click(); URL.revokeObjectURL(url);
      setNeedsPreparation(false);
    } catch { setError("Не удалось скачать PDF. Попробуйте ещё раз."); } finally { setAction("idle"); }
  }
  async function prepare() {
    if (action !== "idle" || !needsPreparation) return;
    setAction("prepare"); setError(null); setStatus(null);
    try {
      const response = await fetch(`/api/reports/${reportId}/pdf/prepare`, { method: "POST", cache: "no-store" });
      if (response.status === 409) {
        setError("Отчёт ещё не готов для подготовки PDF. Попробуйте позже.");
        return;
      }
      if (!response.ok) throw new Error("pdf_prepare_failed");
      setNeedsPreparation(false);
      setStatus("PDF готов. Нажмите «Скачать PDF».");
    } catch { setError("Не удалось подготовить PDF. Попробуйте ещё раз."); } finally { setAction("idle"); }
  }
  return <div className="mt-6"><button type="button" onClick={() => void download()} disabled={action !== "idle"} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border border-brand bg-transparent px-5 py-3 text-center font-semibold text-brand disabled:opacity-60">{action === "download" ? "Скачиваем PDF…" : "Скачать PDF"}</button>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}{needsPreparation && <button type="button" onClick={() => void prepare()} disabled={action !== "idle"} className="mt-3 inline-flex min-h-14 w-full items-center justify-center rounded-xl border border-brand px-5 py-3 font-semibold text-brand disabled:opacity-60">{action === "prepare" ? "Готовим PDF…" : "Подготовить PDF"}</button>}{status && <p role="status" className="mt-2 text-sm text-muted">{status}</p>}</div>;
}
