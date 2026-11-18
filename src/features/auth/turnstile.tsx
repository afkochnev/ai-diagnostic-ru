"use client";

import { useEffect, useRef, useState } from "react";

type TurnstileOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "error-callback": () => void;
  "unsupported-callback": () => void;
  "response-field": false;
  "refresh-expired": "auto";
  retry: "never";
  language: "ru";
  theme: "light";
  size: "flexible" | "compact";
};
type TurnstileApi = { render: (container: HTMLElement, options: TurnstileOptions) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: TurnstileApi } }

let scriptPromise: Promise<TurnstileApi> | null = null;
const scriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>("script[data-auth-turnstile]");
    const created = !script;
    if (!script) {
      script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      script.defer = true;
      script.dataset.authTurnstile = "true";
    }
    const element = script;
    const timer = window.setTimeout(() => failed(), 15000);
    function cleanListeners() {
      window.clearTimeout(timer);
      element.removeEventListener("load", loaded);
      element.removeEventListener("error", failed);
    }
    function loaded() {
      cleanListeners();
      if (window.turnstile) resolve(window.turnstile);
      else failed();
    }
    function failed() {
      cleanListeners();
      element.remove();
      scriptPromise = null;
      reject(new Error("captcha_script_unavailable"));
    }
    element.addEventListener("load", loaded, { once: true });
    element.addEventListener("error", failed, { once: true });
    if (created) document.head.appendChild(element);
  });
  return scriptPromise;
}

export function Turnstile({ siteKey, onToken, onRetry }: { siteKey: string; onToken: (token: string) => void; onRetry: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "checking" | "verified" | "error">("loading");

  useEffect(() => {
    let disposed = false;
    let widgetId: string | undefined;
    let api: TurnstileApi | undefined;
    const invalidate = (error = false) => {
      if (disposed) return;
      onToken("");
      setStatus(error ? "error" : "checking");
    };
    loadTurnstile().then((loadedApi) => {
      if (disposed || !container.current) return;
      api = loadedApi;
      setStatus("checking");
      widgetId = api.render(container.current, {
        sitekey: siteKey,
        callback: (token) => { if (!disposed) { onToken(token); setStatus("verified"); } },
        "expired-callback": () => invalidate(),
        "timeout-callback": () => invalidate(true),
        "error-callback": () => invalidate(true),
        "unsupported-callback": () => invalidate(true),
        "response-field": false,
        "refresh-expired": "auto",
        retry: "never",
        language: "ru",
        theme: "light",
        size: container.current.clientWidth < 300 ? "compact" : "flexible",
      });
    }).catch(() => invalidate(true));
    return () => {
      disposed = true;
      if (api && widgetId !== undefined) api.remove(widgetId);
    };
  }, [siteKey, onToken]);

  return <div className="space-y-2">
    <div ref={container} aria-label="Проверка безопасности" />
    {status === "loading" && <p className="text-xs text-muted" role="status">Загружаем проверку безопасности…</p>}
    {status === "error" && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
      <p>Не удалось выполнить проверку безопасности. Проверьте соединение и попробуйте ещё раз.</p>
      <button type="button" className="mt-2 min-h-10 underline" onClick={onRetry}>Повторить проверку</button>
    </div>}
  </div>;
}
