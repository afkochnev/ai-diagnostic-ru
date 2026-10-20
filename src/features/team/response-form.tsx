"use client";
import { startTransition, useActionState, useSyncExternalStore, type FormEvent } from "react";
import { saveTeamResponseAction } from "@/server/team/actions";
import type { TeamResponse } from "@/server/team/contracts";
const subscribe = () => () => {};
export function TeamResponseForm({ response }: { response: TeamResponse }) {
  const [state, action, pending] = useActionState(saveTeamResponseAction, { revision: response.revision, status: response.status });
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  if (state.status === "completed") return <div role="status" className="rounded-xl bg-tint p-5">Спасибо! Ваши ответы отправлены. Владелец компании видит только статус «Завершил».</div>;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const answers = Object.fromEntries(response.questions.map((question) => {
      const raw = String(form.get(question.id) ?? "");
      return [question.id, question.answer_type === "scale_0_4" ? raw === "" ? null : Number(raw) : raw];
    }));
    form.set("answers",JSON.stringify(answers));
    form.set("intent",(event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ?? "save");
    // Dispatch without the browser/React action reset: drafts stay visible after
    // success and validation failure, and each save reads actual form controls.
    startTransition(() => action(form));
  }
  return <form action={action} onSubmit={submit} className="space-y-6"><input type="hidden" name="participantId" value={response.participant_id} /><input type="hidden" name="revision" value={state.revision ?? response.revision} />{response.questions.map((q,index) => <fieldset key={q.id} className="rounded-xl border border-line p-5"><legend className="px-2 text-sm text-muted">{q.block_title}</legend><label htmlFor={`q-${q.id}`} className="block font-medium">{index+1}. {q.prompt}{q.required ? " *" : ""}</label>{q.help && <p id={`help-${q.id}`} className="mt-2 text-sm text-muted">{q.help}</p>}{q.answer_type === "scale_0_4" ? <select id={`q-${q.id}`} name={q.id} defaultValue={response.answers[q.id] === null || response.answers[q.id] === undefined ? "" : String(response.answers[q.id])} aria-describedby={q.help ? `help-${q.id}` : undefined} className="mt-3 min-h-12 w-full rounded-xl border border-line bg-white p-3"><option value="">Выберите ответ</option>{q.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <textarea id={`q-${q.id}`} name={q.id} defaultValue={String(response.answers[q.id] ?? "")} maxLength={10000} rows={4} aria-describedby={q.help ? `help-${q.id}` : undefined} className="mt-3 w-full rounded-xl border border-line p-3" />}</fieldset>)}{state.error && <p role="alert">{state.error}</p>}{state.revision !== response.revision && !state.error && <p role="status">Ответы сохранены.</p>}<div className="flex flex-wrap gap-4"><button disabled={pending || !hydrated} name="intent" value="save" className="rounded-xl border border-line px-5 py-3">Сохранить ответы</button><button disabled={pending || !hydrated} name="intent" value="submit" className="rounded-xl bg-brand px-5 py-3 font-semibold text-white">Завершить участие</button></div><p className="text-sm text-muted">После завершения ответы изменить нельзя. Обязательные вопросы отмечены звёздочкой.</p></form>;
}
