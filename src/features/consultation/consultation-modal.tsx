"use client";
import { useState } from "react";

type State = "closed" | "form" | "submitting" | "success" | "duplicate" | "error";
export function ConsultationModal({ email, diagnosticId, reportId }: { email: string; diagnosticId: string; reportId: string }) {
  const [state, setState] = useState<State>("closed");
  const [name, setName] = useState("");
  const [contactType, setContactType] = useState<"" | "phone" | "telegram">("");
  const [contactValue, setContactValue] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2 || name.trim().length > 100) { setError("Введите имя от 2 до 100 символов."); return; }
    if (contactType && !contactValue.trim()) { setError("Укажите значение дополнительного контакта."); return; }
    if (!contactType && contactValue.trim()) { setError("Выберите способ связи."); return; }
    if (comment.length > 3000) { setError("Комментарий не должен превышать 3000 символов."); return; }
    setState("submitting"); setError("");
    try {
      const response = await fetch("/api/lead-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ diagnostic_id: diagnosticId, report_id: reportId, name, contact_type: contactType || null, contact_value: contactValue || null, comment: comment || null, idempotency_key: crypto.randomUUID() }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("failed");
      setState(result.duplicate ? "duplicate" : "success");
    } catch { setState("error"); }
  }
  if (state === "closed") return <button type="button" onClick={() => setState("form")} className="mt-3 inline-flex min-h-12 items-center rounded-xl border border-brand px-5 py-3 font-semibold text-brand">Получить консультацию</button>;
  if (state === "success" || state === "duplicate") return <div role="status" className="mt-3 rounded-xl border border-line bg-tint p-5"><p className="font-semibold">{state === "duplicate" ? "Заявка уже отправлена." : "Спасибо! Заявка отправлена."}</p><button type="button" onClick={() => setState("closed")} className="mt-3 text-sm underline">Вернуться к отчёту</button></div>;
  return <div className="mt-3 rounded-2xl border border-line bg-white p-6 shadow-card"><h2 className="text-xl font-semibold">Получить консультацию</h2><form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4"><label className="block text-sm font-medium">Имя *<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-line px-4" /></label><label className="block text-sm font-medium">Email<input value={email} readOnly className="mt-1 min-h-12 w-full rounded-xl border border-line bg-slate-50 px-4 text-muted" /></label><label className="block text-sm font-medium">Способ связи<select value={contactType} onChange={(event) => setContactType(event.target.value as "" | "phone" | "telegram")} className="mt-1 min-h-12 w-full rounded-xl border border-line px-4"><option value="">Не указывать</option><option value="phone">Телефон</option><option value="telegram">Telegram</option></select></label><label className="block text-sm font-medium">Значение контакта<input value={contactValue} onChange={(event) => setContactValue(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-line px-4" /></label><label className="block text-sm font-medium">Комментарий<textarea value={comment} onChange={(event) => setComment(event.target.value)} className="mt-1 min-h-28 w-full rounded-xl border border-line px-4 py-3" /></label>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex flex-wrap gap-3"><button type="submit" disabled={state === "submitting"} className="min-h-12 rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-60">{state === "submitting" ? "Отправляем…" : "Отправить заявку"}</button><button type="button" onClick={() => setState("closed")} className="min-h-12 rounded-xl border border-line px-5 py-3">Отмена</button></div></form></div>;
}
