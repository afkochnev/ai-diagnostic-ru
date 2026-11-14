import { withRequestTimeout } from "./request-timeout";

type StatusPayload = {
  status: string;
  version?: number;
};

const retryDelayMs = 3000;
const pollingWindowMs = 300_000;

export async function requestStatus(url: string, method: "GET" | "POST", signal: AbortSignal): Promise<StatusPayload> {
  return withRequestTimeout(async requestSignal => {
    const response = await fetch(url, { method, cache: "no-store", signal: requestSignal });
    if (!response.ok) throw new Error("status_unavailable");
    const body: Partial<StatusPayload> | null = await response.json();
    if (typeof body?.status !== "string") throw new Error("invalid_status");
    return {
      status: body.status,
      version: typeof body.version === "number" ? body.version : undefined,
    };
  }, signal);
}

export function startStatusPolling(url: string, {
  delayMs,
  acceptedStatuses,
  onStatus,
  onUnavailable,
  onPause,
}: {
  delayMs: number;
  acceptedStatuses: readonly string[];
  onStatus: (body: StatusPayload) => boolean;
  onUnavailable: () => void;
  onPause: () => void;
}): () => void {
  const scope = new AbortController();
  let next: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(() => {
    stop();
    onPause();
  }, pollingWindowMs);

  function stop() {
    scope.abort();
    clearTimeout(deadline);
    clearTimeout(next);
  }

  async function poll() {
    let body: StatusPayload;
    try {
      body = await requestStatus(url, "GET", scope.signal);
      if (!acceptedStatuses.includes(body.status)) throw new Error("invalid_status");
    } catch {
      if (scope.signal.aborted) return;
      onUnavailable();
      next = setTimeout(poll, retryDelayMs);
      return;
    }
    if (scope.signal.aborted) return;
    if (onStatus(body)) stop();
    else next = setTimeout(poll, delayMs);
  }

  void poll();
  return stop;
}
