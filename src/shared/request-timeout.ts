const requestTimeoutMs = 15_000;

export async function withRequestTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const request = new AbortController();
  const abort = () => request.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, requestTimeoutMs);
  try {
    return await operation(request.signal);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
