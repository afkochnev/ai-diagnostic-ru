"use client";

import { useCallback, useEffect, useState } from "react";
import { Turnstile } from "./turnstile";

type ProtectionState = { status: "loading" | "error" } | { status: "ready"; enabled: boolean; siteKey: string | null };

export function useAuthProtection(required: boolean) {
  const [token, setToken] = useState("");
  const [revision, setRevision] = useState(0);
  const [reload, setReload] = useState(0);
  const [config, setConfig] = useState<ProtectionState>({ status: "loading" });
  const reset = useCallback(() => { setToken(""); setRevision((value) => value + 1); }, []);
  const retryConfig = useCallback(() => { setConfig({ status: "loading" }); setReload((value) => value + 1); }, []);

  useEffect(() => {
    if (!required) return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    fetch("/api/auth/protection", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("protection_unavailable");
      const data = await response.json() as { enabled?: unknown; configured?: unknown; siteKey?: unknown };
      if (data.configured !== true || typeof data.enabled !== "boolean" || (data.enabled && (typeof data.siteKey !== "string" || !data.siteKey))) throw new Error("protection_unavailable");
      if (active) setConfig({ status: "ready", enabled: data.enabled, siteKey: data.enabled ? data.siteKey as string : null });
    }).catch(() => { if (active) setConfig({ status: "error" }); })
      .finally(() => window.clearTimeout(timer));
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [required, reload]);

  return { required, token, setToken, revision, config, reset, retryConfig,
    blocked: required && (config.status !== "ready" || (config.enabled && !token)),
  };
}

export function AuthProtection({ protection }: { protection: ReturnType<typeof useAuthProtection> }) {
  if (!protection.required) return null;
  const { token, revision, config, setToken, reset, retryConfig } = protection;
  return <>
    <input type="hidden" name="auth_captcha_token" value={token} />
    {config.status === "loading" && <p role="status" className="text-xs text-muted">Загружаем проверку безопасности…</p>}
    {config.status === "error" && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
      <p>Не удалось загрузить проверку безопасности. Проверьте соединение и попробуйте ещё раз.</p>
      <button type="button" className="mt-2 min-h-10 underline" onClick={retryConfig}>Повторить проверку</button>
    </div>}
    {config.status === "ready" && config.enabled && config.siteKey && <Turnstile key={revision} siteKey={config.siteKey} onToken={setToken} onRetry={reset} />}
  </>;
}
