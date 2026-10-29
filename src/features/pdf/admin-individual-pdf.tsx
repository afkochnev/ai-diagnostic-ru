"use client";
import { useRef, useState } from "react";

type Ready = { report_id: string; ai_report_version: number; template_version: string; artifact_id: string; status: "ready"; checksum: string; download_url: string };
function readyFor(value: unknown, reportId: string, version: number): Ready {
  const v = value as Partial<Ready> | null;
  if (!v || v.report_id !== reportId || v.ai_report_version !== version || v.status !== "ready" || v.template_version !== "stage12-1i" || !/^[a-f0-9]{64}$/.test(v.checksum ?? "") || !/^[a-f0-9-]{36}$/i.test(v.artifact_id ?? "") || v.download_url !== `/api/admin/report-artifacts/${v.artifact_id}`) throw Error("invalid_receipt");
  return v as Ready;
}
export function AdminIndividualPdf({ reportId, version }: { reportId: string; version: number }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<Ready | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const base = `/api/admin/reports/${reportId}/pdf`;

  async function requestPdf() {
    if (busy.current || stopped) return;
    busy.current = true; setPending(true); setMessage(null);
    try {
      let response = await fetch(base, { cache: "no-store", redirect: "error" });
      if (response.status === 409) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        if (failure?.error !== "pdf_not_ready") throw Error("conflict");
        response = await fetch(`${base}/prepare`, { method: "POST", cache: "no-store", redirect: "error" });
      }
      if (!response.ok) throw Error("pdf_failed");
      const ready = readyFor(await response.json(), reportId, version);
      setReceipt(ready);
      setMessage("PDF готов.");
    } catch {
      setStopped(true);
      setMessage("Не удалось получить PDF. Не запускайте повторную подготовку; проверьте состояние артефакта.");
    } finally {
      busy.current = false; setPending(false);
    }
  }

  return <div className="mt-4 space-y-3" aria-label={`PDF отчёта v${version}`}>
    <p className="text-sm text-slate-600">PDF сохранённого отчёта v{version}</p>
    {!receipt && !stopped && <button type="button" onClick={() => void requestPdf()} disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Получаем PDF…" : "Получить PDF-отчёт"}</button>}
    {receipt && <a href={receipt.download_url} download className="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Скачать PDF-отчёт</a>}
    {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
  </div>;
}
