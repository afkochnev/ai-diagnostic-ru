"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestStatus, startStatusPolling } from "@/shared/status-polling";
import { ReportGenerationProgress } from "./report-generation-progress";

const reportStatuses = ["missing", "queued", "generating", "completed", "failed"];

export function ReportRegenerationButton({ diagnosticId, failed = false, currentVersion }: { diagnosticId: string; failed?: boolean; currentVersion?: number }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "preparing" | "queued" | "request-unknown" | "failed">("idle");
  const [connectionIssue, setConnectionIssue] = useState(false);
  const [paused, setPaused] = useState(false);
  const [closed, setClosed] = useState(false);
  const [checks, setChecks] = useState(0);
  const [requestedVersion, setRequestedVersion] = useState<number>();
  const activeRequest = useRef<AbortController | null>(null);
  const watching = state === "queued" || state === "request-unknown";
  const endpoint = `/api/diagnostics/${diagnosticId}`;

  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => {
    if (!watching) return;
    return startStatusPolling(`${endpoint}/ai`, {
      delayMs: 1500,
      acceptedStatuses: reportStatuses,
      onStatus({ status, version }) {
        setConnectionIssue(false);
        if (requestedVersion !== undefined && (version === undefined || version < requestedVersion)) return false;
        if (status === "completed") {
          // After an unconfirmed POST the latest completed result may be the old one.
          if (state === "request-unknown" && (version === undefined || version <= (currentVersion ?? 0))) return true;
          router.refresh();
          return true;
        }
        if (status === "failed") {
          if (state === "request-unknown" && (version === undefined || version <= (currentVersion ?? 0))) return true;
          setState("failed");
          return true;
        }
        if (state === "request-unknown" && (status === "queued" || status === "generating")) {
          setRequestedVersion(version);
          setState("queued");
          return true;
        }
        return state === "request-unknown";
      },
      onUnavailable() {
        setConnectionIssue(true);
        setClosed(true);
      },
      onPause() {
        setPaused(true);
        setClosed(true);
      },
    });
  }, [endpoint, router, watching, state, currentVersion, requestedVersion, checks]);

  async function request() {
    if (activeRequest.current || state === "queued") return;
    const scope = new AbortController();
    activeRequest.current = scope;
    setState("preparing");
    setClosed(false);
    setConnectionIssue(false);
    setPaused(false);
    setRequestedVersion(undefined);
    try {
      const body = await requestStatus(`${endpoint}/reports`, "POST", scope.signal);
      if (!["queued", "generating", "completed"].includes(body.status)) throw new Error("status_unavailable");
      if (scope.signal.aborted) return;
      setRequestedVersion(body.version);
      setState("queued");
    } catch {
      if (!scope.signal.aborted) {
        setClosed(true);
        setState("request-unknown");
      }
    } finally {
      activeRequest.current = null;
    }
  }

  return <div className="mt-6 text-center">
    {(state === "preparing" || state === "queued") && !closed && <ReportGenerationProgress state="generating" onClose={() => setClosed(true)} />}
    <button type="button" onClick={() => void request()} disabled={state === "preparing" || state === "queued"} className="text-sm font-medium text-muted underline underline-offset-4 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60">
      {state === "preparing" ? "Запрашиваем новый отчёт…" : state === "queued" ? "Новый отчёт готовится" : failed || state === "failed" ? "Повторить формирование AI-отчёта" : "Сформировать новый отчёт"}
    </button>
    {state === "failed" && <p role="alert" className="mt-2 text-sm text-red-700">Не удалось подготовить новый отчёт. Можно повторить формирование.</p>}
    {state === "request-unknown" && <p role="status" className="mt-2 text-sm text-muted">Сервер не подтвердил запрос. Проверьте статус перед повторным запросом.</p>}
    {connectionIssue && !paused && <p role="status" className="mt-2 text-sm text-muted">Не удалось проверить готовность отчёта. Проверим статус ещё раз.</p>}
    {paused && <p role="status" className="mt-2 text-sm text-muted">Автоматическая проверка приостановлена. Проверьте статус, чтобы продолжить ожидание.</p>}
    {watching && closed && <button type="button" onClick={() => {
      setConnectionIssue(false);
      setPaused(false);
      setChecks(value => value + 1);
    }} className="ml-3 mt-2 text-sm font-semibold underline">Проверить статус</button>}
  </div>;
}
