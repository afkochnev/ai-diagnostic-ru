"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { AnswerScale, AnswerScaleGuide } from "@/features/diagnostic/answer-scale";
import { saveTeamResponseAction } from "@/server/team/actions";
import type { TeamActionState, TeamQuestion, TeamResponse } from "@/server/team/contracts";

type Answers = TeamResponse["answers"];
const subscribe = () => () => {};
const answersHash = (answers: Answers) => JSON.stringify(Object.entries(answers).sort(([a], [b]) => a.localeCompare(b)));
const hasAnswer = (question: TeamQuestion, value: Answers[string]) => question.answer_type === "text" ? typeof value === "string" && value.trim().length > 0 : typeof value === "number" && value >= 0 && value <= 4;

export function TeamResponseForm({ response }: { response: TeamResponse }) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const blocks = useMemo(() => Array.from(new Set(response.questions.map((question) => question.block_id))).map((id) => ({ id, title: response.questions.find((question) => question.block_id === id)!.block_title, questions: response.questions.filter((question) => question.block_id === id) })), [response.questions]);
  const initialAnswers = useMemo(() => Object.fromEntries(response.questions.map((question) => [question.id, response.answers[question.id] ?? (question.answer_type === "text" ? "" : null)])), [response.answers, response.questions]);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [state, setState] = useState<TeamActionState>({ revision: response.revision, status: response.status });
  const firstIncompleteBlock = blocks.findIndex((block) => block.questions.some((question) => question.required && !hasAnswer(question, initialAnswers[question.id])));
  const [viewIndex, setViewIndex] = useState(Math.max(0, firstIncompleteBlock < 0 ? blocks.length - 1 : firstIncompleteBlock));
  const [saving, setSaving] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [navigationPending, setNavigationPending] = useState(false);
  const [missingIds, setMissingIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState("");
  const answersRef = useRef(answers);
  const stateRef = useRef(state);
  const persistedHash = useRef(answersHash(initialAnswers));
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationPendingRef = useRef(false);
  const blockHeading = useRef<HTMLHeadingElement>(null);
  const questionRefs = useRef<Record<string, HTMLElement | null>>({});
  const currentBlock = blocks[Math.min(viewIndex, blocks.length - 1)];
  const required = response.questions.filter((question) => question.required);
  const answered = required.filter((question) => hasAnswer(question, answers[question.id])).length;
  const resultPath = `/ru/team/responses/${response.participant_id}/result`;

  const save = useCallback((intent: "save" | "submit" = "save") => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const operation = saveQueue.current.then(async () => {
      if (stateRef.current.status === "completed") return true;
      const snapshot = answersRef.current;
      const hash = answersHash(snapshot);
      if (intent === "save" && hash === persistedHash.current) return true;
      setSaving("saving");
      const form = new FormData();
      form.set("participantId", response.participant_id);
      form.set("revision", String(stateRef.current.revision ?? response.revision));
      form.set("answers", JSON.stringify(snapshot));
      form.set("intent", intent);
      try {
        const result = await saveTeamResponseAction(stateRef.current, form);
        stateRef.current = result;
        setState(result);
        if (result.error) { setSaving("error"); return false; }
        persistedHash.current = hash;
        setSaving(answersHash(answersRef.current) === hash ? "saved" : "unsaved");
        if (result.status === "completed") { router.push(`/ru/team/responses/${response.participant_id}/result`); router.refresh(); }
        return true;
      } catch {
        const next = { ...stateRef.current, error: "Не удалось сохранить ответы. Они остались на экране. Попробуйте ещё раз." };
        stateRef.current = next;
        setState(next);
        setSaving("error");
        return false;
      }
    });
    saveQueue.current = operation.then(() => true, () => false);
    return operation;
  }, [response.participant_id, response.revision, router]);

  useEffect(() => {
    if (state.status === "completed" || answersHash(answers) === persistedHash.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 1500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [answers, save, state.status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const warn = (event: BeforeUnloadEvent) => {
      if (stateRef.current.status !== "completed" && answersHash(answersRef.current) !== persistedHash.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function update(question: TeamQuestion, value: number | string) {
    const next = { ...answersRef.current, [question.id]: value };
    answersRef.current = next;
    setAnswers(next);
    setSaving("unsaved");
    setMissingIds((current) => current.filter((id) => id !== question.id));
    setValidationError("");
  }

  function showMissing(questions: TeamQuestion[]) {
    setMissingIds(questions.map((question) => question.id));
    setValidationError("Ответьте на отмеченные обязательные вопросы, чтобы продолжить.");
    const first = questions[0];
    setViewIndex(Math.max(0, blocks.findIndex((block) => block.id === first.block_id)));
    requestAnimationFrame(() => {
      const card = questionRefs.current[first.id];
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.querySelector<HTMLElement>("textarea, input")?.focus();
    });
  }

  async function navigate(next: number) {
    if (navigationPendingRef.current || !currentBlock) return;
    navigationPendingRef.current = true; setNavigationPending(true);
    try {
      if (!(await save())) return;
      const missing = next > viewIndex ? currentBlock.questions.filter((question) => question.required && !hasAnswer(question, answersRef.current[question.id])) : [];
      if (missing.length) { showMissing(missing); return; }
      setValidationError(""); setMissingIds([]); setViewIndex(next);
      requestAnimationFrame(() => { blockHeading.current?.scrollIntoView({ behavior: "smooth", block: "start" }); blockHeading.current?.focus({ preventScroll: true }); });
    } finally { navigationPendingRef.current = false; setNavigationPending(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (navigationPendingRef.current) return;
    navigationPendingRef.current = true; setNavigationPending(true);
    try {
      const missing = required.filter((question) => !hasAnswer(question, answersRef.current[question.id]));
      if (missing.length) { await save(); showMissing(missing); return; }
      await save("submit");
    } finally { navigationPendingRef.current = false; setNavigationPending(false); }
  }

  if (state.status === "completed") return <div role="status" className="rounded-xl bg-tint p-5"><p>Спасибо! Ваши ответы отправлены. Теперь вы можете посмотреть свою оценку и скачать PDF.</p><Link href={resultPath} className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-brand px-5 py-3 font-semibold text-white">Посмотреть мой результат</Link></div>;
  if (!currentBlock) return null;

  return <form onSubmit={submit} className="space-y-6">
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap justify-between gap-2 text-sm text-muted"><span>Блок {viewIndex + 1} из {blocks.length}</span><span>Отвечено {answered} из {required.length} обязательных вопросов</span></div>
      <div role="progressbar" aria-label="Заполнение анкеты" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={answered} className="mt-3 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${required.length ? answered / required.length * 100 : 0}%` }} /></div>
      <p role="status" aria-live="polite" className="mt-3 text-sm text-muted">{saving === "saved" ? "Все ответы сохранены. Можно вернуться к анкете позже." : saving === "saving" ? "Сохранение…" : saving === "error" ? "Ответы пока не сохранены. Повторите сохранение." : "Есть несохранённые ответы…"}</p>
    </div>
    <h2 ref={blockHeading} tabIndex={-1} className="scroll-mt-6 text-2xl font-semibold outline-none">{currentBlock.title}</h2>
    {currentBlock.questions.some((question) => question.answer_type === "scale_0_4") ? <AnswerScaleGuide id="team-answer-scale-guide" /> : <p className="text-sm text-muted">Отвечайте о текущей ситуации в компании. Достаточно нескольких предложений; обязательные вопросы отмечены звёздочкой.</p>}
    {validationError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{validationError}</p>}
    {currentBlock.questions.map((question) => {
      const invalid = missingIds.includes(question.id);
      const index = response.questions.findIndex((candidate) => candidate.id === question.id);
      return <fieldset disabled={navigationPending || !hydrated} ref={(element) => { questionRefs.current[question.id] = element; }} key={question.id} className={`rounded-xl border p-5 ${invalid ? "border-red-500" : "border-line"}`}>
        <legend className="sr-only">Вопрос {index + 1}</legend>
        <label htmlFor={question.answer_type === "text" ? `q-${question.id}` : undefined} className="block font-medium">{index + 1}. {question.prompt}{question.required ? " *" : ""}</label>
        {question.help && <p id={`help-${question.id}`} className="mt-2 text-sm text-muted">{question.help}</p>}
        {question.answer_type === "scale_0_4" ? <AnswerScale name={question.id} label={question.prompt} value={answers[question.id]} invalid={invalid} describedBy={`team-answer-scale-guide${question.help ? ` help-${question.id}` : ""}`} onChange={(value) => update(question, value)} /> : <textarea id={`q-${question.id}`} name={question.id} value={String(answers[question.id] ?? "")} onChange={(event) => update(question, event.target.value)} maxLength={10000} rows={4} aria-invalid={invalid || undefined} aria-describedby={question.help ? `help-${question.id}` : undefined} className="mt-3 w-full rounded-xl border border-line p-3" />}
        {invalid && <p className="mt-2 text-sm text-red-800">Ответьте на этот вопрос.</p>}
      </fieldset>;
    })}
    {state.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}
    <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
      <button type="button" disabled={navigationPending || !hydrated} onClick={() => void save()} className="min-h-12 rounded-xl border border-line px-5 py-3 disabled:opacity-50">Сохранить ответы</button>
      <div className="flex gap-3"><button type="button" disabled={viewIndex === 0 || navigationPending || !hydrated} onClick={() => void navigate(viewIndex - 1)} className="min-h-12 flex-1 rounded-xl border border-line px-5 py-3 disabled:opacity-50">Назад</button>{viewIndex < blocks.length - 1 ? <button type="button" disabled={navigationPending || !hydrated} onClick={() => void navigate(viewIndex + 1)} className="min-h-12 flex-1 rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-50">Далее</button> : <button disabled={navigationPending || !hydrated} type="submit" className="min-h-12 flex-1 rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-50">Завершить участие</button>}</div>
    </div>
    <p className="text-sm text-muted">Ответы сохраняются автоматически. После завершения их изменить нельзя. Ваш личный результат будет доступен сразу; AI-отчёт для него не создаётся.</p>
  </form>;
}
