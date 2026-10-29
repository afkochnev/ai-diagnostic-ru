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
  const [needsPreparation, setNeedsPreparation] = useState(false);
  const [receipt, setReceipt] = useState<Ready | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const base = `/api/admin/reports/${reportId}/pdf`;
  async function act(prepare: boolean) {
    if (busy.current || stopped) return;
    busy.current = true; setPending(true); setMessage(null);
    try {
      const response = await fetch(prepare ? `${base}/prepare` : base, { ...(prepare ? { method: "POST" } : {}), cache: "no-store", redirect: "error" });
      if (!prepare && response.status === 409) {
        const failure = await response.json();
        if (failure.error === "pdf_not_ready") { setNeedsPreparation(true); setMessage("PDF ещё не готов."); return; }
        throw Error("conflict");
      }
      if (!response.ok) throw Error("pdf_failed");
      const ready = readyFor(await response.json(), reportId, version);
      setReceipt(ready); setNeedsPreparation(false); setMessage("PDF готов.");
    } catch { setStopped(true); setMessage("Не удалось подтвердить PDF. Повторную подготовку не запускайте; проверьте состояние артефакта."); }
    finally { busy.current = false; setPending(false); }
  }
  return <div className="mt-4 space-y-3" aria-label={`PDF отчёта v${version}`}>
    <p className="text-sm text-slate-600">PDF сохранённого отчёта v{version}</p>
    {!receipt && !needsPreparation && !stopped && <button type="button" onClick={() => void act(false)} disabled={pending} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">{pending ? "Проверяем PDF…" : "Проверить PDF"}</button>}
    {needsPreparation && !stopped && <button type="button" onClick={() => void act(true)} disabled={pending} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">{pending ? "Готовим PDF…" : "Подготовить PDF"}</button>}
    {receipt && <a href={receipt.download_url} download className="inline-block rounded-lg border border-slate-300 px-3 py-2 text-sm">Скачать PDF</a>}
    {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
  </div>;
}
