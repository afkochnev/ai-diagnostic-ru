"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnswerScale, AnswerScaleGuide } from "./answer-scale";
import type { DiagnosticPageData } from "@/server/diagnostic/service";

export type RunnerData={diagnostic:Pick<DiagnosticPageData["diagnostic"],"id"|"revision"|"current_block_id"|"company_id">;company:{name:string};blocks:DiagnosticPageData["blocks"]};
type Props = { data: RunnerData; navigation?: ReactNode; anonymous?:boolean };
type Question = DiagnosticPageData["blocks"][number]["questions"][number];
const inputClass = "mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-3 py-3 text-base text-brand";
const answersHash = (value: Record<string, number | string>) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

export function DiagnosticRunner({ data, navigation, anonymous=false }: Props) {
  const router = useRouter();
  const apiBase=anonymous?"/api/acquisition":`/api/diagnostics/${data.diagnostic.id}`;
  const returnPath=anonymous?"/ru/free?paused=1":`/ru/companies/${data.diagnostic.company_id}`;
  const initialAnswers = useMemo(() => Object.fromEntries(data.blocks.flatMap((block) => block.questions.flatMap((question) => question.answer ? [[question.id, question.answer.numeric_value ?? question.answer.text_value ?? ""]] : []))) as Record<string, number | string>, [data.blocks]);
  const [answers, setAnswers] = useState<Record<string, number | string>>(initialAnswers);
  const [revision, setRevision] = useState(data.diagnostic.revision);
  const [saving, setSaving] = useState<"idle" | "unsaved" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [submitError, setSubmitError] = useState<string[]>([]);
  const [missingRequiredIds, setMissingRequiredIds] = useState<string[]>([]);
  const [navigationPending, setNavigationPending] = useState(false);
  const navigationPendingRef = useRef(false);
  const questionRefs = useRef<Record<string, HTMLElement | null>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const revisionRef = useRef(revision);
  const answersRef = useRef(answers);
  const persistedAnswersHashRef = useRef(answersHash(initialAnswers));
  const initialIndex = Math.max(0, data.blocks.findIndex((block) => block.id === data.diagnostic.current_block_id));
  const [viewIndex, setViewIndex] = useState(initialIndex);
  const currentIndex = Math.min(Math.max(0, viewIndex), Math.max(0, data.blocks.length - 1));
  const currentBlock = data.blocks[currentIndex] ?? data.blocks[0];

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { revisionRef.current = revision; }, [revision]);

  const save = useCallback(async (nextBlockId = currentBlock.id) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const operation = saveQueue.current.then(async () => {
      setSaving("saving"); setError("");
      const currentAnswers = answersRef.current;
      const currentHash = answersHash(currentAnswers);
      const answersDirty = currentHash !== persistedAnswersHashRef.current;
      const payload = { expected_revision: revisionRef.current, mutation_id: crypto.randomUUID(), current_block_id: nextBlockId, answers_dirty: answersDirty, answers: answersDirty ? Object.entries(currentAnswers).map(([question_id, value]) => ({ question_id, value })) : [] };
      try {
        const response = await fetch(`${apiBase}/answers`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const body = await response.json().catch(() => null) as { revision?: number; error?: string; code?: string } | null;
        if (!response.ok || !body?.revision) { setSaving("error"); setError(response.status === 409 ? "Диагностика изменена в другой вкладке. Обновите страницу и повторите действие." : "Не удалось сохранить ответы. Попробуйте ещё раз."); return false; }
        revisionRef.current = body.revision; persistedAnswersHashRef.current = currentHash; setRevision(body.revision); setSaving(answersHash(answersRef.current) === currentHash ? "saved" : "unsaved");
        return true;
      } catch {
        setSaving("error"); setError("Не удалось сохранить ответы. Попробуйте ещё раз."); return false;
      }
    });
    saveQueue.current = operation.then(() => true, () => false);
    return operation;
  }, [currentBlock.id, apiBase]);

  useEffect(() => {
    if (answersHash(answers) === persistedAnswersHashRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 900);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [answers, save]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const warn = (event: BeforeUnloadEvent) => {
      if (answersHash(answersRef.current) !== persistedAnswersHashRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const saveAndReturn = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (navigationPendingRef.current) return;
    navigationPendingRef.current = true; setNavigationPending(true);
    try { if (await save()) router.push(returnPath); }
    finally { navigationPendingRef.current = false; setNavigationPending(false); }
  };

  const update = (question: Question, value: number | string) => {
    setMissingRequiredIds((current) => current.filter((id) => id !== question.id));
    setValidationError("");
    setSaving("unsaved");
    setAnswers((current) => {
      const next = { ...current, [question.id]: value };
      answersRef.current = next;
      return next;
    });
  };
  const navigate = async (index: number, validateRequired = true) => {
    if (navigationPendingRef.current) return;
    const missing = getMissingRequiredQuestions(currentBlock.questions, answersRef.current);
    if (validateRequired && missing.length) {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      setMissingRequiredIds(missing.map((question) => question.id));
      void save(currentBlock.id);
      setValidationError("Ответьте на все обязательные вопросы, чтобы продолжить.");
      const first = questionRefs.current[missing[0].id];
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.querySelector<HTMLElement>("textarea, input")?.focus();
      return;
    }
    setValidationError("");
    navigationPendingRef.current = true;
    setNavigationPending(true);
    try {
      if (await save(data.blocks[index].id)) setViewIndex(index);
      if (typeof window !== "undefined") window.requestAnimationFrame(() => {
        const heading = document.getElementById("diagnostic-block-heading");
        heading?.scrollIntoView({ behavior: "smooth", block: "start" }); heading?.focus({ preventScroll: true });
      });
    } finally {
      navigationPendingRef.current = false;
      setNavigationPending(false);
    }
  };
  const submit = async () => {
    if (navigationPendingRef.current) return;
    navigationPendingRef.current = true; setNavigationPending(true); setSubmitError([]);
    try {
      if (!(await save(currentBlock.id))) return;
      const response = await fetch(`${apiBase}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_revision: revisionRef.current }) });
      const body = await response.json();
      if (!response.ok) { setError("Не удалось завершить диагностику. Попробуйте ещё раз."); return; }
      if (!body.ok) {
        const missing = (body.missing ?? []) as Array<{ question_id: string; block_id: string; position: number }>;
        setMissingRequiredIds(missing.map((question) => question.question_id));
        setSubmitError(missing.map((question) => `Вопрос ${question.position} · ${data.blocks.find((block) => block.id === question.block_id)?.title ?? "Блок диагностики"}`));
        if (missing.length) {
          setViewIndex(Math.max(0, data.blocks.findIndex((block) => block.id === missing[0].block_id)));
          if (typeof window !== "undefined") window.requestAnimationFrame(() => {
            const first = questionRefs.current[missing[0].question_id];
            first?.scrollIntoView({ behavior: "smooth", block: "center" }); first?.querySelector<HTMLElement>("textarea, input")?.focus();
          });
        }
        return;
      }
      router.push(anonymous ? "/ru/free" : `/ru/diagnostics/${data.diagnostic.id}/result`);
    } catch { setError("Не удалось завершить диагностику. Ваши ответы сохранены. Попробуйте ещё раз."); }
    finally { navigationPendingRef.current = false; setNavigationPending(false); }
  };
  if (!currentBlock) return null;
  const requiredQuestions = data.blocks.flatMap((block) => block.questions).filter((question) => question.is_required);
  const answeredQuestions = requiredQuestions.filter((question) => isDiagnosticAnswerPresent(question, answers[question.id])).length;
  return <>{navigation}<main id="main-content" className="min-h-[70vh] py-8 sm:py-12"><div className="mx-auto w-full max-w-4xl px-5 sm:px-8"><div className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><Link href={returnPath} onClick={(event) => void saveAndReturn(event)} className="text-sm underline">{anonymous?"Моя диагностика":"В кабинет"}</Link><p className="mt-4 text-sm text-muted">{anonymous?"Шаг 1 из 3 · Диагностика":data.company.name}</p><h1 id="diagnostic-block-heading" tabIndex={-1} className="mt-1 scroll-mt-6 text-3xl font-semibold tracking-tight outline-none">{currentBlock.title}</h1></div><div className="text-sm text-muted"><p>Блок {currentIndex + 1} из {data.blocks.length}</p><p className="mt-1">Отвечено {answeredQuestions} из {requiredQuestions.length} обязательных вопросов</p></div></div><div role="progressbar" aria-label="Заполнение анкеты" aria-valuemin={0} aria-valuemax={requiredQuestions.length} aria-valuenow={answeredQuestions} className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(requiredQuestions.length ? answeredQuestions / requiredQuestions.length : 0) * 100}%` }} /></div><div className="mt-7 flex items-center gap-2 text-sm text-muted" aria-live="polite">{saving === "saving" && "Сохранение…"}{(saving === "saved" || saving === "idle") && "Все ответы сохранены"}{saving === "unsaved" && "Есть несохранённые ответы…"}{saving === "error" && "Ошибка сохранения"}</div>{error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{validationError && <p role="alert" data-testid="required-answer-error" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{validationError}</p>}{submitError.length>0 && <div role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800"><p>Заполните обязательные вопросы:</p><ul className="mt-2 list-disc pl-5">{submitError.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}<section className="mt-5 space-y-5">{currentBlock.questions.some((question) => question.answer_type === "scale_0_4") ? <AnswerScaleGuide id="diagnostic-answer-scale-guide" /> : <p className="text-sm text-muted">Отвечайте о текущей ситуации в компании. Достаточно нескольких предложений.</p>}{currentBlock.questions.map((question) => <QuestionCard key={question.id} question={question} value={answers[question.id]} invalid={missingRequiredIds.includes(question.id)} disabled={navigationPending} containerRef={(element) => { questionRefs.current[question.id] = element; }} onChange={(value) => update(question, value)} />)}</section><div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><Link href={returnPath} onClick={(event) => void saveAndReturn(event)} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line px-5 py-3 font-semibold hover:bg-tint">{anonymous?"Сохранить и выйти":"Сохранить и выйти в кабинет"}</Link><div className="flex gap-3"><button type="button" disabled={currentIndex === 0 || navigationPending} onClick={() => void navigate(currentIndex - 1, false)} className="min-h-12 flex-1 rounded-xl border border-line px-5 py-3 font-semibold hover:bg-tint disabled:cursor-not-allowed disabled:opacity-50">Назад</button>{currentIndex < data.blocks.length - 1 ? <button type="button" disabled={navigationPending} onClick={() => void navigate(currentIndex + 1)} className="min-h-12 flex-1 rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-50">Далее</button> : <button type="button" disabled={navigationPending} onClick={() => void submit()} className="min-h-12 flex-1 rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-50">Завершить диагностику</button>}</div></div></div></main></>;
}

function QuestionCard({ question, value, invalid, disabled, containerRef, onChange }: { question: Question; value?: number | string; invalid: boolean; disabled: boolean; containerRef: (element: HTMLElement | null) => void; onChange: (value: number | string) => void }) {
  return <article ref={containerRef} data-invalid={invalid || undefined} className={`rounded-2xl border bg-white p-5 shadow-card sm:p-7 ${invalid ? "border-red-500" : "border-line"}`}>
    <div className="flex items-start justify-between gap-4"><h2 className="text-base font-medium leading-relaxed">{question.prompt}</h2>{question.is_required && <span className="shrink-0 text-xs text-muted">Обязательно</span>}</div>
    {question.help_text && <p id={`help-${question.id}`} className="mt-2 text-sm text-muted">{question.help_text}</p>}
    {question.answer_type === "text" ? <textarea disabled={disabled} aria-label={question.prompt} aria-invalid={invalid || undefined} aria-describedby={question.help_text ? `help-${question.id}` : undefined} className={`${inputClass} min-h-32`} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} placeholder="Введите ответ" /> : <AnswerScale name={question.id} label={question.prompt} value={value} invalid={invalid} disabled={disabled} describedBy={`diagnostic-answer-scale-guide${question.help_text ? ` help-${question.id}` : ""}`} onChange={onChange} />}
    {invalid && <p className="mt-2 text-sm text-red-800">Ответьте на этот вопрос.</p>}
  </article>;
}

export function getMissingRequiredQuestions(questions: Array<Pick<Question, "id" | "is_required" | "answer_type">>, answers: Record<string, number | string>) {
  return questions.filter((question) => question.is_required && !isDiagnosticAnswerPresent(question, answers[question.id]));
}

export function isDiagnosticAnswerPresent(question: Pick<Question, "answer_type">, value: number | string | undefined) {
  if (value === undefined || value === null) return false;
  return question.answer_type === "text" ? String(value).trim().length > 0 : typeof value === "number";
}
