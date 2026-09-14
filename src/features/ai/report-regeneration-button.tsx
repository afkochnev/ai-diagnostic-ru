"use client";
import { useEffect, useState } from "react";
import { ReportGenerationProgress } from "./report-generation-progress";

export function ReportRegenerationButton({ diagnosticId }: { diagnosticId: string }) {
  const [state, setState] = useState<"idle" | "preparing" | "queued" | "error">("idle");
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (state !== "queued") return;
    let active = true;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/diagnostics/${diagnosticId}/ai`, { method: "POST", cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { status?: string };
      if (!active) return;
      if (body.status === "completed") window.location.reload();
      if (!response.ok || body.status === "failed") setState("error");
    }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [diagnosticId, state]);
  async function request() {
    if (state === "preparing") return;
    setState("preparing");
    try {
      const response = await fetch(`/api/diagnostics/${diagnosticId}/reports`, { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      setClosed(false); setState("queued");
    } catch { setState("error"); }
  }
  return <div className="mt-6 text-center">{(state === "preparing" || state === "queued") && !closed && <ReportGenerationProgress state="generating" onClose={() => setClosed(true)} />}<button type="button" onClick={() => void request()} disabled={state === "preparing" || state === "queued"} className="text-sm font-medium text-muted underline underline-offset-4 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60">{state === "preparing" ? "Запрашиваем новый отчёт…" : state === "queued" ? "Новый отчёт готовится" : "Сформировать новый отчёт"}</button>{state === "error" && <p role="alert" className="mt-2 text-sm text-red-700">Не удалось запустить формирование отчёта. Попробуйте ещё раз.</p>}</div>;
}
