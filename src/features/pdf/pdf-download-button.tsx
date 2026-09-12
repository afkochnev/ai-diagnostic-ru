"use client";
import { useState } from "react";

export function PdfDownloadButton({ reportId }: { reportId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  async function download() {
    if (loading) return;
    setLoading(true); setError(false);
    try {
      const prepared = await fetch(`/api/reports/${reportId}/pdf/prepare`, { method: "POST", cache: "no-store" });
      if (!prepared.ok) throw new Error("pdf_prepare_failed");
      const response = await fetch(`/api/reports/${reportId}/pdf`, { cache: "no-store" });
      if (!response.ok) throw new Error("pdf_failed");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url;
      const disposition = response.headers.get("content-disposition");
      const match = disposition?.match(/filename="?([^";]+)"?/i);
      link.download = match?.[1] ?? "management-ai-audit.pdf";
      link.click(); URL.revokeObjectURL(url);
    } catch { setError(true); } finally { setLoading(false); }
  }
  return <div className="mt-6"><button type="button" onClick={() => void download()} disabled={loading} className="inline-flex min-h-12 items-center rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-60">{loading ? "Готовим PDF…" : "Скачать PDF"}</button>{error && <p role="alert" className="mt-2 text-sm text-red-700">Не удалось подготовить PDF. Попробуйте ещё раз.</p>}</div>;
}
