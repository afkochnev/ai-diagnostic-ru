"use client";
import { useState } from "react";

type State = "closed" | "form" | "submitting" | "success" | "error";
export function FeedbackModal({ diagnosticId }: { diagnosticId: string }) {
  const [state, setState] = useState<State>("closed");
  const [rating, setRating] = useState(0);
  const [useful, setUseful] = useState("");
  const [improve, setImprove] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!rating) { setError("Выберите оценку от 1 до 5."); return; }
    setState("submitting"); setError("");
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ diagnostic_id: diagnosticId, rating, useful: useful || null, improve: improve || null }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("failed");
      setState(result.duplicate ? "success" : "success");
    } catch { setState("error"); }
  }
  if (state === "closed") return <button type="button" onClick={() => setState("form")} className="mt-3 inline-flex min-h-12 items-center rounded-xl border border-brand px-5 py-3 font-semibold text-brand">Оценить аудит</button>;
  if (state === "success") return <div role="status" className="mt-3 rounded-xl border border-line bg-tint p-5"><p className="font-semibold">Спасибо за обратную связь</p></div>;
  return <div className="mt-3 rounded-2xl border border-line bg-white p-6 shadow-card"><h2 className="text-xl font-semibold">Оцените аудит</h2><form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4"><fieldset><legend className="text-sm font-medium">Рейтинг: 1–5 *</legend><div className="mt-2 flex flex-wrap gap-2">{[1,2,3,4,5].map((value) => <button key={value} type="button" aria-label={`Оценка ${value}`} aria-pressed={rating === value} onClick={() => setRating(value)} className={`min-h-11 min-w-11 rounded-xl border px-3 ${rating === value ? "bg-brand text-white" : "border-line"}`}>{value}</button>)}</div></fieldset><label className="block text-sm font-medium">Что было наиболее полезно?<textarea value={useful} onChange={(event) => setUseful(event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-line px-4 py-3" /></label><label className="block text-sm font-medium">Что стоит улучшить?<textarea value={improve} onChange={(event) => setImprove(event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-line px-4 py-3" /></label>{error && <p role="alert" className="text-sm text-red-700">{error === "" ? "Не удалось отправить оценку. Попробуйте ещё раз." : error}</p>}{state === "error" && <p role="alert" className="text-sm text-red-700">Не удалось отправить оценку. Попробуйте ещё раз.</p>}<div className="flex flex-wrap gap-3"><button type="submit" disabled={state === "submitting"} className="min-h-12 rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-60">{state === "submitting" ? "Отправляем…" : "Отправить"}</button><button type="button" onClick={() => setState("closed")} className="min-h-12 rounded-xl border border-line px-5 py-3">Отмена</button></div></form></div>;
}
