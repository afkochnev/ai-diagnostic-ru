"use client";
import { pilotText as tr } from "@/i18n/pilot-copy";
import { useLocale } from "@/i18n/context";
import { useRef, useState } from "react";

export function PdfDownloadButton({ reportId, team=false }: { reportId: string; team?: boolean }) {
  const locale = useLocale();

  const [action, setAction] = useState<"idle" | "download" | "prepare">("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const base=`/api/${team?"team-reports":"reports"}/${reportId}/pdf`;
  async function download() {
    if (busy.current) return;
    busy.current = true;
    setAction("download"); setError(null);
    try {
      let response = await fetch(base, { cache: "no-store" });
      if (response.status === 409) {
        // The user's download click also requests the missing PDF. Viewing the
        // page and the GET endpoint remain read-only; AI is never regenerated.
        setAction("prepare");
        const prepared = await fetch(`${base}/prepare`, { method: "POST", cache: "no-store" });
        if (!prepared.ok) {
          setError(prepared.status === 409 ? tr(locale, "Отчёт ещё не готов. Попробуйте скачать PDF немного позже.") : prepared.status === 429 ? tr(locale, "Слишком много запросов. Попробуйте скачать PDF позже.") : tr(locale, "Не удалось подготовить PDF. Попробуйте ещё раз."));
          return;
        }
        setAction("download");
        response = await fetch(base, { cache: "no-store" });
      }
      if (!response.ok) throw new Error("pdf_failed");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url;
      const disposition = response.headers.get("content-disposition");
      const match = disposition?.match(/filename="?([^";]+)"?/i);
      link.download = match?.[1] ?? "management-ai-audit.pdf";
      link.click(); URL.revokeObjectURL(url);
    } catch { setError(tr(locale, "Не удалось скачать PDF. Попробуйте ещё раз.")); } finally { busy.current = false; setAction("idle"); }
  }
  return <div className="mt-6"><button type="button" onClick={() => void download()} disabled={action !== "idle"} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border border-brand bg-transparent px-5 py-3 text-center font-semibold text-brand disabled:opacity-60">{action === "prepare" ? tr(locale, "Готовим PDF…") : action === "download" ? tr(locale, "Скачиваем PDF…") : tr(locale, "Скачать PDF")}</button>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}
