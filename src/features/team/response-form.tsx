"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { AnswerScale, AnswerScaleGuide } from "@/features/diagnostic/answer-scale";
import { QuestionnaireIntro } from "@/features/diagnostic/questionnaire-intro";
import { DictatedAnswer } from "@/features/diagnostic/dictated-answer";
import { questionHelpForDisplay } from "@/shared/question-help";
import { withRequestTimeout } from "@/shared/request-timeout";
import type { TeamActionState, TeamQuestion, TeamResponse } from "@/server/team/contracts";

type Answers = TeamResponse["answers"];
type PendingSave = { revision: number; hash: string; submit: boolean };
type SaveState = Pick<TeamResponse, "revision" | "status">;
const conflictMessage = "Ответы изменились в другой вкладке. Обновите страницу перед сохранением.";
const confirmationMessage = "Не удалось подтвердить сохранение. Ответы остались на экране. Попробуйте ещё раз.";
const limitedMessage = "Ответы остались в открытой вкладке.";
const sessionMessage = "Вход изменился или срок сессии истёк. Войдите с адресом, на который получили приглашение. Ответы остались в этой вкладке.";
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
  const [retrySubmit, setRetrySubmit] = useState(false);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [needsSession, setNeedsSession] = useState(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const [missingIds, setMissingIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState("");
  const answersRef = useRef(answers);
  const stateRef = useRef(state);
  const persistedHash = useRef(answersHash(initialAnswers));
  const pendingSave = useRef<PendingSave | null>(null);
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAt = useRef(0);
  const manualSubmitAfterLimit = useRef(false);
  const sessionBlocked = useRef(false);
  const verifySessionOnSave = useRef(false);
  const navigationPendingRef = useRef(false);
  const blockHeading = useRef<HTMLHeadingElement>(null);
  const questionRefs = useRef<Record<string, HTMLElement | null>>({});
  const currentBlock = blocks[Math.min(viewIndex, blocks.length - 1)];
  const required = response.questions.filter((question) => question.required);
  const answered = required.filter((question) => hasAnswer(question, answers[question.id])).length;
  const resultPath = `/ru/team/responses/${response.participant_id}/result`;
  const loginPath = `/ru/login?method=email&next=${encodeURIComponent(`/ru/team/responses/${response.participant_id}`)}`;

  const apiPath = "/api/team/responses/" + response.participant_id;
  const rateLimited = retrySeconds > 0;

  const save = useCallback((intent: "save" | "submit" = "save") => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const operation = saveQueue.current.then(async () => {
      if (stateRef.current.status === "completed") return true;
      if (sessionBlocked.current) return false;
      if (Date.now() < retryAt.current) return false;
      if (!verifySessionOnSave.current && !pendingSave.current && intent === "save" && answersHash(answersRef.current) === persistedHash.current) return true;
      setSaving("saving");
      function finish(result: SaveState, hash: string) {
        pendingSave.current = null;
        manualSubmitAfterLimit.current = false;
        stateRef.current = result;
        setState(result);
        setNeedsSession(false);
        persistedHash.current = hash;
        setSaving(answersHash(answersRef.current) === hash ? "saved" : "unsaved");
        if (result.status === "completed") { router.push(resultPath); router.refresh(); }
      }
      function fail(error: string, retryFinal = Boolean(pendingSave.current?.submit && pendingSave.current.hash === answersHash(answersRef.current))) {
        const next = { ...stateRef.current, error };
        stateRef.current = next;
        setState(next);
        setRetrySubmit(retryFinal);
        setSaving("error");
        return false;
      }
      async function readSaved() {
        return withRequestTimeout(async signal => {
          const current = await fetch(apiPath, { cache: "no-store", signal });
          if (current.status === 401 || current.status === 403 || current.status === 404) throw Error("team_session_unavailable");
          if (!current.ok) throw Error("status_unavailable");
          const body = await current.json() as Pick<TeamResponse, "revision" | "status" | "answers">;
          signal.throwIfAborted();
          verifySessionOnSave.current = false;
          return body;
        });
      }
      async function reconcile(pending: PendingSave) {
        const saved = await readSaved();
        const hash = answersHash(saved.answers);
        if (saved.revision === pending.revision + 1 && hash === pending.hash && saved.status === (pending.submit ? "completed" : "started")) {
          finish({ revision: saved.revision, status: saved.status }, hash);
          return "saved";
        }
        return saved.revision === pending.revision && saved.status !== "completed" ? "unchanged" : "conflict";
      }
      try {
        let earlier = pendingSave.current;
        if (earlier) {
          const outcome = await reconcile(earlier);
          if (stateRef.current.status === "completed") return true;
          if (outcome === "conflict") {
            pendingSave.current = null;
            return fail(conflictMessage);
          }
          if (outcome === "saved") earlier = null;
        }
        let resumed: SaveState | undefined;
        if (verifySessionOnSave.current) {
          const saved = await readSaved();
          if (saved.revision !== stateRef.current.revision || saved.status === "completed") return fail(conflictMessage);
          resumed = { revision: saved.revision, status: saved.status };
        }
        const snapshot = answersRef.current;
        const hash = answersHash(snapshot);
        if (!earlier && intent === "save" && hash === persistedHash.current) {
          if (resumed) finish(resumed, hash);
          return true;
        }
        const revision = stateRef.current.revision ?? response.revision;
        const submit = intent === "submit";
        pendingSave.current = { revision, hash, submit };
        const { result, status, retryAfter } = await withRequestTimeout(async signal => {
          const saved = await fetch(apiPath, {
            method: "PATCH", headers: { "content-type": "application/json" }, signal,
            body: JSON.stringify({ revision, answers: snapshot, submit }),
          });
          if (saved.status === 401 || saved.status === 403) {
            pendingSave.current = earlier;
            throw Error("team_session_unavailable");
          }
          const result = await saved.json().catch(error => {
            if (saved.status !== 429) throw error;
            return {};
          }) as TeamActionState;
          signal.throwIfAborted();
          if (saved.status >= 500) throw Error("save_unavailable");
          return { result, status: saved.status, retryAfter: saved.headers.get("Retry-After") };
        });
        if (status === 429) {
          const serverDelay = [Number(retryAfter), result?.retryAfterSeconds]
            .find(seconds => typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0);
          const delay = Math.min(serverDelay ?? 60, 3600);
          retryAt.current = Date.now() + delay * 1000;
          setRetrySeconds(delay);
          // This write was refused. An earlier write with a lost response may still commit.
          pendingSave.current = earlier;
          manualSubmitAfterLimit.current = submit;
          return fail(limitedMessage, submit);
        }
        if (status === 409 && earlier) {
          // The first write can commit after the earlier read and before this retry.
          pendingSave.current = earlier;
          const outcome = await reconcile(earlier);
          if (outcome === "saved") {
            if (stateRef.current.status === "completed" || (!submit && hash === persistedHash.current)) return true;
            return fail(confirmationMessage);
          }
        }
        if (status >= 400) {
          pendingSave.current = null;
          return fail(result.error ?? confirmationMessage);
        }
        if (result.revision !== revision + 1 || result.status !== (submit ? "completed" : "started")) throw Error("save_unavailable");
        finish({ revision: result.revision, status: result.status }, hash);
        return true;
      } catch (error) {
        if (error instanceof Error && error.message === "team_session_unavailable") {
          sessionBlocked.current = true;
          verifySessionOnSave.current = true;
          setNeedsSession(true);
          return fail(sessionMessage, intent === "submit");
        }
        return fail(confirmationMessage);
      }
    });
    saveQueue.current = operation.then(() => true, () => false);
    return operation;
  }, [apiPath, response.revision, resultPath, router]);

  useEffect(() => {
    if (!rateLimited) return;
    const clock = setInterval(() => {
      const seconds = Math.max(0, Math.ceil((retryAt.current - Date.now()) / 1000));
      setRetrySeconds(seconds);
      if (seconds === 0 && stateRef.current.error === limitedMessage && !manualSubmitAfterLimit.current &&
        !pendingSave.current && answersHash(answersRef.current) === persistedHash.current) {
        const savedState = { ...stateRef.current, error: undefined };
        stateRef.current = savedState;
        setState(savedState);
        setSaving("saved");
      }
    }, 1000);
    return () => clearInterval(clock);
  }, [rateLimited]);

  useEffect(() => {
    if (needsSession || rateLimited || manualSubmitAfterLimit.current || state.status === "completed" || (!pendingSave.current && answersHash(answers) === persistedHash.current)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 1500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [answers, needsSession, rateLimited, save, state.status]);

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
    if (manualSubmitAfterLimit.current) {
      manualSubmitAfterLimit.current = false;
      setRetrySubmit(false);
    }
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
      {saving !== "saved" && <p role="status" aria-live="polite" className="mt-3 text-sm text-muted">{rateLimited ? "Сохранение временно приостановлено." : saving === "saving" ? "Сохранение…" : saving === "error" ? "Не удалось подтвердить сохранение." : "Есть несохранённые ответы…"}</p>}
    </div>
    <h2 ref={blockHeading} tabIndex={-1} className="scroll-mt-6 text-2xl font-semibold outline-none">{currentBlock.title}</h2>
    {viewIndex === 0 && <QuestionnaireIntro />}
    {currentBlock.questions.some((question) => question.answer_type === "scale_0_4") && <AnswerScaleGuide id="team-answer-scale-guide" />}
    {validationError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{validationError}</p>}
    {currentBlock.questions.map((question) => {
      const invalid = missingIds.includes(question.id);
      const index = response.questions.findIndex((candidate) => candidate.id === question.id);
      const help = questionHelpForDisplay(question.help, question.answer_type);
      return <fieldset disabled={navigationPending || !hydrated} ref={(element) => { questionRefs.current[question.id] = element; }} key={question.id} className={`rounded-xl border p-5 ${invalid ? "border-red-500" : "border-line"}`}>
        <legend className="sr-only">Вопрос {index + 1}</legend>
        <label htmlFor={question.answer_type === "text" ? `q-${question.id}` : undefined} className="block font-medium">{index + 1}. {question.prompt}{question.required ? " *" : ""}</label>
        {help && <p id={`help-${question.id}`} className="mt-2 text-sm text-muted">{help}</p>}
        {question.answer_type === "scale_0_4" ? <AnswerScale name={question.id} label={question.prompt} value={answers[question.id]} invalid={invalid} describedBy={`team-answer-scale-guide${help ? ` help-${question.id}` : ""}`} onChange={(value) => update(question, value)} /> : <DictatedAnswer id={`q-${question.id}`} name={question.id} disabled={navigationPending || !hydrated} value={String(answers[question.id] ?? "")} onChange={(value) => update(question, value)} maxLength={10000} rows={4} aria-invalid={invalid || undefined} aria-describedby={help ? `help-${question.id}` : undefined} className="mt-4 min-h-32 w-full rounded-xl border border-line p-3" />}
        {invalid && <p className="mt-2 text-sm text-red-800">Ответьте на этот вопрос.</p>}
      </fieldset>;
    })}
    {state.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}
    {needsSession && <div className="space-y-3 rounded-xl border border-line bg-white p-4">
      <a href={loginPath} target="_blank" rel="noopener noreferrer" className="block underline">Войти с адресом приглашения в новой вкладке</a>
      <p className="text-sm text-muted">После входа вернитесь к этой анкете и повторите сохранение.</p>
      <button type="button" disabled={navigationPending || rateLimited || !hydrated} className="min-h-12 rounded-xl border border-line px-5 py-3 disabled:opacity-50" onClick={() => {
        sessionBlocked.current = false;
        void save(retrySubmit ? "submit" : "save");
      }}>{retrySubmit ? "Я вошёл — повторить отправку" : "Я вошёл — повторить сохранение"}</button>
    </div>}
    {rateLimited && <p className="text-sm text-muted">{`Повторить ${retrySubmit ? "отправку" : "сохранение"} можно через ${retrySeconds} сек.`}</p>}
    <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
      {saving === "error" && !needsSession && <button type="button" disabled={navigationPending || rateLimited || !hydrated} onClick={() => void save(retrySubmit ? "submit" : "save")} className="min-h-12 rounded-xl border border-line px-5 py-3 disabled:opacity-50">{retrySubmit ? "Повторить отправку" : "Повторить сохранение"}</button>}
      <div className="flex gap-3 sm:ml-auto"><button type="button" disabled={viewIndex === 0 || needsSession || navigationPending || rateLimited || !hydrated} onClick={() => void navigate(viewIndex - 1)} className="min-h-12 flex-1 rounded-xl border border-line px-5 py-3 disabled:opacity-50">Назад</button>{viewIndex < blocks.length - 1 ? <button type="button" disabled={needsSession || navigationPending || rateLimited || !hydrated} onClick={() => void navigate(viewIndex + 1)} className="min-h-12 flex-1 rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-50">Далее</button> : <button disabled={needsSession || navigationPending || rateLimited || !hydrated} type="submit" className="min-h-12 flex-1 rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-50">Завершить участие</button>}</div>
    </div>
    <p className="text-sm text-muted">Ответы сохраняются автоматически. После завершения их изменить нельзя. Ваш личный результат будет доступен сразу; AI-отчёт для него не создаётся.</p>
  </form>;
}
