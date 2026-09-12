"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DiagnosticPageData } from "@/server/diagnostic/service";

type Props = { data: DiagnosticPageData };
type Question = DiagnosticPageData["blocks"][number]["questions"][number];
const inputClass = "mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-3 py-3 text-base text-brand";

export function DiagnosticRunner({ data }: Props) {
  const router = useRouter();
  const initialAnswers = useMemo(() => Object.fromEntries(data.blocks.flatMap((block) => block.questions.flatMap((question) => question.answer ? [[question.id, question.answer.numeric_value ?? question.answer.text_value ?? ""]] : []))) as Record<string, number | string>, [data.blocks]);
  const [answers, setAnswers] = useState<Record<string, number | string>>(initialAnswers);
  const [revision, setRevision] = useState(data.diagnostic.revision);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [submitError, setSubmitError] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revisionRef = useRef(revision);
  const answersRef = useRef(answers);
  const currentIndex = Math.max(0, data.blocks.findIndex((block) => block.id === data.diagnostic.current_block_id));
  const currentBlock = data.blocks[currentIndex] ?? data.blocks[0];

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { revisionRef.current = revision; }, [revision]);

  const save = useCallback(async (nextBlockId = currentBlock.id) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setSaving("saving"); setError("");
    const payload = { expected_revision: revisionRef.current, mutation_id: crypto.randomUUID(), current_block_id: nextBlockId, answers: Object.entries(answersRef.current).map(([question_id, value]) => ({ question_id, value })) };
    const response = await fetch(`/api/diagnostics/${data.diagnostic.id}/answers`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null) as { revision?: number; error?: string; code?: string } | null;
    if (!response.ok || !body?.revision) { setSaving("error"); setError(response.status === 409 ? "Диагностика изменена в другой вкладке. Обновите страницу и повторите действие." : "Не удалось сохранить ответы. Попробуйте ещё раз."); return false; }
    revisionRef.current = body.revision; setRevision(body.revision); setSaving("saved"); return true;
  }, [currentBlock.id, data.diagnostic.id]);

  useEffect(() => {
    if (!Object.keys(answers).length) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 900);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [answers, save]);

  const update = (question: Question, value: number | string) => setAnswers((current) => ({ ...current, [question.id]: value }));
  const navigate = async (index: number) => { if (!(await save(data.blocks[index].id))) return; router.refresh(); };
  const submit = async () => { if (!(await save(currentBlock.id))) return; setSubmitError([]); const response = await fetch(`/api/diagnostics/${data.diagnostic.id}/submit`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({expected_revision:revisionRef.current}) }); const body = await response.json(); if (!response.ok) { setError("Не удалось завершить диагностику. Попробуйте ещё раз."); return; } if (!body.ok) { setSubmitError((body.missing ?? []).map((m:{block_id:string;position:number}) => `Не заполнен вопрос ${m.position} в блоке`)); return; } router.push(`/ru/diagnostics/${data.diagnostic.id}/result`); };
  if (!currentBlock) return null;
  return <main id="main-content" className="min-h-[70vh] py-8 sm:py-12"><div className="mx-auto w-full max-w-4xl px-5 sm:px-8"><div className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><Link href="/ru/dashboard" className="text-sm underline">В кабинет</Link><p className="mt-4 text-sm text-muted">{data.company.name}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{currentBlock.title}</h1></div><span className="text-sm text-muted">Блок {currentIndex + 1} из {data.blocks.length}</span></div><div className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${((currentIndex + 1) / data.blocks.length) * 100}%` }} /></div><div className="mt-7 flex items-center gap-2 text-sm text-muted" aria-live="polite">{saving === "saving" && "Сохраняем…"}{saving === "saved" && "Сохранено"}{saving === "error" && "Ошибка сохранения"}</div>{error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{submitError.length>0 && <div role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800"><p>Заполните обязательные вопросы:</p><ul className="mt-2 list-disc pl-5">{submitError.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}<section className="mt-5 space-y-5">{currentBlock.questions.map((question) => <QuestionCard key={question.id} question={question} value={answers[question.id]} onChange={(value) => update(question, value)} />)}</section><div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><Link href="/ru/dashboard" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line px-5 py-3 font-semibold hover:bg-tint">В кабинет</Link><div className="flex gap-3"><button type="button" disabled={currentIndex === 0 || saving === "saving"} onClick={() => void navigate(currentIndex - 1)} className="min-h-12 flex-1 rounded-xl border border-line px-5 py-3 font-semibold hover:bg-tint disabled:cursor-not-allowed disabled:opacity-50">Назад</button>{currentIndex < data.blocks.length - 1 ? <button type="button" disabled={saving === "saving"} onClick={() => void navigate(currentIndex + 1)} className="min-h-12 flex-1 rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-50">Далее</button> : <button type="button" disabled={saving === "saving"} onClick={() => void submit()} className="min-h-12 flex-1 rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-50">Завершить диагностику</button>}</div></div></div></main>;
}

function QuestionCard({ question, value, onChange }: { question: Question; value?: number | string; onChange: (value: number | string) => void }) {
  return <article className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-7"><div className="flex items-start justify-between gap-4"><h2 className="text-base font-medium leading-relaxed">{question.prompt}</h2>{question.is_required && <span className="shrink-0 text-xs text-muted">Обязательно</span>}</div>{question.answer_type === "text" ? <textarea className={`${inputClass} min-h-32`} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} onBlur={() => undefined} placeholder="Введите ответ" /> : <div className="mt-5 grid grid-cols-5 gap-2">{[1, 2, 3, 4, 5].map((display) => { const score = display - 1; return <button key={display} type="button" aria-pressed={value === score} onClick={() => onChange(score)} className={`min-h-12 rounded-xl border px-2 py-3 text-base font-semibold ${value === score ? "border-brand bg-brand text-white" : "border-line hover:bg-tint"}`}>{display}</button>; })}</div>}</article>;
}
