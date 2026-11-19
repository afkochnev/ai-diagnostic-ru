"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnswerScale, AnswerScaleGuide } from "./answer-scale";
import { QuestionnaireIntro } from "./questionnaire-intro";
import { DictatedAnswer } from "./dictated-answer";
import { questionHelpForDisplay } from "@/shared/question-help";
import { withRequestTimeout } from "@/shared/request-timeout";
import type { DiagnosticPageData } from "@/server/diagnostic/service";

export type RunnerData={diagnostic:Pick<DiagnosticPageData["diagnostic"],"id"|"revision"|"current_block_id"|"company_id">;company:{name:string};blocks:DiagnosticPageData["blocks"]};
type Props = { data: RunnerData; navigation?: ReactNode; anonymous?:boolean };
type Question = DiagnosticPageData["blocks"][number]["questions"][number];
type PendingSave = { nextBlockId: string; answersHash: string; requestBody: string };
const inputClass = "mt-4 min-h-32 w-full rounded-xl border border-line bg-white px-3 py-3 text-base text-brand";
const answersHash = (value: Record<string, number | string>) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

export function DiagnosticRunner({ data, navigation, anonymous=false }: Props) {
  const router = useRouter();
  const apiBase=anonymous?"/api/acquisition":`/api/diagnostics/${data.diagnostic.id}`;
  const diagnosticPath = anonymous ? "/ru/free" : `/ru/diagnostics/${data.diagnostic.id}`;
  const returnPath=anonymous?"/ru/free?paused=1":`/ru/companies/${data.diagnostic.company_id}`;
  const initialAnswers = useMemo(() => Object.fromEntries(data.blocks.flatMap((block) => block.questions.flatMap((question) => question.answer ? [[question.id, question.answer.numeric_value ?? question.answer.text_value ?? ""]] : []))) as Record<string, number | string>, [data.blocks]);
  const [answers, setAnswers] = useState<Record<string, number | string>>(initialAnswers);
  const [saving, setSaving] = useState<"idle" | "unsaved" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [submitError, setSubmitError] = useState<string[]>([]);
  const [missingRequiredIds, setMissingRequiredIds] = useState<string[]>([]);
  const [navigationPending, setNavigationPending] = useState(false);
  const [submissionUnconfirmed, setSubmissionUnconfirmed] = useState(false);
  const navigationPendingRef = useRef(false);
  const navigationScrollPending = useRef(false);
  const questionRefs = useRef<Record<string, HTMLElement | null>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const pendingSave = useRef<PendingSave | null>(null);
  // The completion RPC accepts the original revision after a successful write.
  const submittedRevision = useRef<number | null>(null);
  const revisionRef = useRef(data.diagnostic.revision);
  const answersRef = useRef(answers);
  const persistedAnswersHashRef = useRef(answersHash(initialAnswers));
  const initialIndex = Math.max(0, data.blocks.findIndex((block) => block.id === data.diagnostic.current_block_id));
  const [viewIndex, setViewIndex] = useState(initialIndex);
  const currentIndex = Math.min(Math.max(0, viewIndex), Math.max(0, data.blocks.length - 1));
  const currentBlock = data.blocks[currentIndex] ?? data.blocks[0];

  useLayoutEffect(() => {
    if (!navigationScrollPending.current || typeof document === "undefined") return;
    navigationScrollPending.current = false;
    const heading = document.getElementById("diagnostic-block-heading");
    heading?.scrollIntoView({ behavior: "auto", block: "start" });
    heading?.focus({ preventScroll: true });
  }, [currentIndex]);

  useEffect(() => { answersRef.current = answers; }, [answers]);

  const save = useCallback(async (nextBlockId = currentBlock.id) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const operation = saveQueue.current.then(async () => {
      if (submittedRevision.current !== null) return false;
      setSaving("saving"); setError("");
      async function send(mutation: PendingSave) {
        try {
          const { response, body } = await withRequestTimeout(async signal => {
            const response = await fetch(`${apiBase}/answers`, {
              method: "PATCH", headers: { "content-type": "application/json" }, body: mutation.requestBody, signal,
            });
            const body = await response.json().catch(() => null) as { revision?: number } | null;
            signal.throwIfAborted();
            return { response, body };
          });
          if (!response.ok || !body?.revision) {
            // A transport failure or 5xx may hide an already committed mutation.
            if (!response.ok && response.status >= 400 && response.status < 500 && response.status !== 408) pendingSave.current = null;
            setSaving("error");
            setError(response.status === 409
              ? "Диагностика изменена в другой вкладке. Обновите страницу и повторите действие."
              : "Не удалось подтвердить сохранение. Ответы остались на экране.");
            return false;
          }
          pendingSave.current = null;
          revisionRef.current = body.revision;
          persistedAnswersHashRef.current = mutation.answersHash;
          return true;
        } catch {
          setSaving("error");
          setError("Не удалось подтвердить сохранение. Ответы остались на экране.");
          return false;
        }
      }

      const previous = pendingSave.current;
      if (previous && !(await send(previous))) return false;
      const currentAnswers = answersRef.current;
      const currentHash = answersHash(currentAnswers);
      const answersDirty = currentHash !== persistedAnswersHashRef.current;
      if (!previous || previous.nextBlockId !== nextBlockId || answersDirty) {
        const mutation = {
          nextBlockId,
          answersHash: currentHash,
          requestBody: JSON.stringify({
            expected_revision: revisionRef.current,
            mutation_id: crypto.randomUUID(),
            current_block_id: nextBlockId,
            answers_dirty: answersDirty,
            answers: answersDirty ? Object.entries(currentAnswers).map(([question_id, value]) => ({ question_id, value })) : [],
          }),
        };
        pendingSave.current = mutation;
        if (!(await send(mutation))) return false;
      }
      setSaving(answersHash(answersRef.current) === currentHash ? "saved" : "unsaved");
      return true;
    });
    saveQueue.current = operation.then(() => true, () => false);
    return operation;
  }, [currentBlock.id, apiBase]);

  useEffect(() => {
    if (!pendingSave.current && answersHash(answers) === persistedAnswersHashRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 900);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [answers, save]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const warn = (event: BeforeUnloadEvent) => {
      if (pendingSave.current || answersHash(answersRef.current) !== persistedAnswersHashRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const saveAndReturn = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (navigationPendingRef.current) return;
    if (submittedRevision.current !== null) { router.push(returnPath); return; }
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
    if (navigationPendingRef.current || submittedRevision.current !== null) return;
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
      if (!(await save(data.blocks[index].id))) return;
      navigationScrollPending.current = true;
      setViewIndex(index);
    } finally {
      navigationPendingRef.current = false;
      setNavigationPending(false);
    }
  };
  const submit = async () => {
    if (navigationPendingRef.current) return;
    navigationPendingRef.current = true;
    setNavigationPending(true);
    setError("");
    setSubmitError([]);
    try {
      if (submittedRevision.current === null) {
        if (!(await save(currentBlock.id))) return;
        submittedRevision.current = revisionRef.current;
      }
      const revision = submittedRevision.current;
      const { response, body } = await withRequestTimeout(async signal => {
        const response = await fetch(`${apiBase}/submit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_revision: revision }),
          signal,
        });
        const body = await response.json();
        signal.throwIfAborted();
        return { response, body };
      });
      if (!response.ok) {
        if (response.status !== 409 || body?.error !== "conflict") throw Error("submit_unconfirmed");
        submittedRevision.current = null;
        setSubmissionUnconfirmed(false);
        setError("Диагностика изменена в другой вкладке. Обновите страницу и повторите действие.");
        return;
      }
      if (body?.ok !== true && (body?.ok !== false || !Array.isArray(body.missing))) throw Error("submit_unconfirmed");
      submittedRevision.current = null;
      setSubmissionUnconfirmed(false);
      if (!body.ok) {
        const missing = body.missing as Array<{ question_id: string; block_id: string; position: number }>;
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
      if (anonymous) router.refresh();
      else router.push(`/ru/diagnostics/${data.diagnostic.id}/result`);
    } catch {
      if (submittedRevision.current === null) {
        setError("Не удалось сохранить ответы. Они остались на экране.");
        return;
      }
      setSubmissionUnconfirmed(true);
      setError("Не удалось подтвердить завершение. Ответы сохранены. Повторите отправку или обновите анкету.");
    } finally {
      navigationPendingRef.current = false;
      setNavigationPending(false);
    }
  };
  if (!currentBlock) return null;
  const requiredQuestions = data.blocks.flatMap((block) => block.questions).filter((question) => question.is_required);
  const answeredQuestions = requiredQuestions.filter((question) => isDiagnosticAnswerPresent(question, answers[question.id])).length;
  return <>{navigation}<main id="main-content" className="min-h-[70vh] py-8 sm:py-12"><div className="mx-auto w-full max-w-4xl px-5 sm:px-8"><div className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><Link href={returnPath} onClick={(event) => void saveAndReturn(event)} className="text-sm underline">{anonymous?"Моя диагностика":"В кабинет"}</Link>{!anonymous && <p className="mt-4 text-sm text-muted">{data.company.name}</p>}<h1 id="diagnostic-block-heading" tabIndex={-1} className="mt-1 scroll-mt-6 text-3xl font-semibold tracking-tight outline-none">{currentBlock.title}</h1></div><div className="text-sm text-muted"><p>Блок {currentIndex + 1} из {data.blocks.length}</p><p className="mt-1">Отвечено {answeredQuestions} из {requiredQuestions.length} обязательных вопросов</p></div></div><div role="progressbar" aria-label="Заполнение анкеты" aria-valuemin={0} aria-valuemax={requiredQuestions.length} aria-valuenow={answeredQuestions} className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(requiredQuestions.length ? answeredQuestions / requiredQuestions.length : 0) * 100}%` }} /></div><div className="mt-5 h-5 text-sm leading-5 text-muted">{saving !== "saved" && saving !== "idle" && <p role="status" aria-live="polite">{saving === "saving" && "Сохранение…"}{saving === "unsaved" && "Есть несохранённые ответы…"}{saving === "error" && "Ошибка сохранения"}</p>}</div>{error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{submissionUnconfirmed && <a href={diagnosticPath} className="mt-3 inline-block text-sm underline">Обновить анкету</a>}{saving === "error" && <button type="button" disabled={navigationPending} onClick={() => void save()} className="mt-3 rounded-xl border border-line px-4 py-2 text-sm font-semibold disabled:opacity-50">Повторить сохранение</button>}{validationError && <p role="alert" data-testid="required-answer-error" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{validationError}</p>}{submitError.length>0 && <div role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800"><p>Заполните обязательные вопросы:</p><ul className="mt-2 list-disc pl-5">{submitError.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
    {currentIndex === 0 && <QuestionnaireIntro />}
    <section className="mt-5 space-y-5">{currentBlock.questions.some((question) => question.answer_type === "scale_0_4") && <AnswerScaleGuide id="diagnostic-answer-scale-guide" />}{currentBlock.questions.map((question) => <QuestionCard key={question.id} question={question} maxTextLength={anonymous ? 10000 : undefined} value={answers[question.id]} invalid={missingRequiredIds.includes(question.id)} disabled={navigationPending || submissionUnconfirmed} containerRef={(element) => { questionRefs.current[question.id] = element; }} onChange={(value) => update(question, value)} />)}</section><div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><Link href={returnPath} onClick={(event) => void saveAndReturn(event)} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line px-5 py-3 font-semibold hover:bg-tint">{anonymous?"Сохранить и выйти":"Сохранить и выйти в кабинет"}</Link><div className="flex gap-3"><button type="button" disabled={currentIndex === 0 || navigationPending || submissionUnconfirmed} onClick={() => void navigate(currentIndex - 1, false)} className="min-h-12 flex-1 rounded-xl border border-line px-5 py-3 font-semibold hover:bg-tint disabled:cursor-not-allowed disabled:opacity-50">Назад</button>{currentIndex < data.blocks.length - 1 ? <button type="button" disabled={navigationPending} onClick={() => void navigate(currentIndex + 1)} className="min-h-12 flex-1 rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-50">Далее</button> : <button type="button" disabled={navigationPending} onClick={() => void submit()} className="min-h-12 flex-1 rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-50">{submissionUnconfirmed ? "Повторить отправку" : "Завершить диагностику"}</button>}</div></div></div></main></>;
}

function QuestionCard({ question, value, invalid, disabled, maxTextLength, containerRef, onChange }: { question: Question; value?: number | string; invalid: boolean; disabled: boolean; maxTextLength?: number; containerRef: (element: HTMLElement | null) => void; onChange: (value: number | string) => void }) {
  const help = questionHelpForDisplay(question.help_text, question.answer_type);
  return <article ref={containerRef} data-invalid={invalid || undefined} className={`rounded-2xl border bg-white p-5 shadow-card sm:p-7 ${invalid ? "border-red-500" : "border-line"}`}>
    <div className="flex items-start justify-between gap-4"><h2 className="text-base font-medium leading-relaxed">{question.prompt}</h2>{question.is_required && <span className="shrink-0 text-xs text-muted">Обязательно</span>}</div>
    {help && <p id={`help-${question.id}`} className="mt-2 text-sm text-muted">{help}</p>}
    {question.answer_type === "text" ? <DictatedAnswer disabled={disabled} aria-label={question.prompt} aria-invalid={invalid || undefined} aria-describedby={help ? `help-${question.id}` : undefined} className={inputClass} rows={4} value={String(value ?? "")} maxLength={maxTextLength} onChange={onChange} placeholder="Введите ответ" /> : <AnswerScale name={question.id} label={question.prompt} value={value} invalid={invalid} disabled={disabled} describedBy={`diagnostic-answer-scale-guide${help ? ` help-${question.id}` : ""}`} onChange={onChange} />}
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
