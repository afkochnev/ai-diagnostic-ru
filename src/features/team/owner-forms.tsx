"use client";
import { useActionState, useState } from "react";
import { createTeamAction, inviteTeamAction, renewTeamInvitationAction } from "@/server/team/actions";
import type { TeamActionState } from "@/server/team/contracts";
const input = "mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-3 py-3";
const button = "mt-4 min-h-12 rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-50";
export function CreateTeamForm({ companyId,defaultTitle }: { companyId: string;defaultTitle?:string }) {
  const [state, action, pending] = useActionState(createTeamAction, {});
  return <form action={action}><input type="hidden" name="companyId" value={companyId} /><label>Название командной диагностики<input name="title" defaultValue={defaultTitle} required minLength={2} maxLength={200} className={input} /></label>{state.error && <p role="alert">{state.error}</p>}<button className={button} disabled={pending}>Создать командную диагностику</button></form>;
}
export function InviteTeamForm({ teamId, participantId }: { teamId: string; participantId?: string }) {
  const [copied, setCopied] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [state, action, pending] = useActionState(async (previous: TeamActionState, form: FormData): Promise<TeamActionState> => {
    setCopied(false);
    const intent = form.get("intent");
    if (intent === "reset") {
      setDisplayName("");
      setEmail("");
      return {};
    }
    const renewalId = participantId ?? (intent === "retry" ? previous.participantId : undefined);
    try {
      if (!renewalId) return await inviteTeamAction({}, form);
      form.set("participantId", renewalId);
      const result = await renewTeamInvitationAction({}, form);
      return result.error ? { ...result, participantId: renewalId } : result;
    } catch {
      return {
        error: "Не удалось получить ответ от сервера. Проверьте подключение и список участников перед повторной отправкой.",
        participantId: renewalId,
      };
    }
  }, {});
  const failed = state.emailStatus === "failed";
  const sent = state.emailStatus === "sent";
  const mock = state.emailStatus === "mock";
  const issued = Boolean(state.participantId);
  return <form action={action} className="space-y-3">
    <input type="hidden" name="teamId" value={teamId} />
    {!participantId && !issued && <>
      <label className="block">Имя участника<input name="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={100} className={input} /></label>
      <label className="block">Email участника<input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} className={input} /></label>
    </>}
    {state.error && <p role="alert">{state.error}</p>}
    {sent && <p role="status">Приглашение отправлено на {state.recipient}.</p>}
    {failed && <div role="alert"><p>Участник добавлен, но письмо отправить не удалось.</p><p>{state.invitationUrl ? "Можно повторить отправку или скопировать защищённую ссылку вручную." : "Можно повторить отправку."}</p></div>}
    {mock && <p role="status">Приглашение создано в тестовом режиме. Внешнее письмо не отправлено.</p>}
    {(!sent || participantId) && <button name="intent" value={issued ? "retry" : "invite"} disabled={pending} className={button}>{pending ? "Отправляем приглашение…" : participantId || issued ? "Отправить повторно" : "Пригласить"}</button>}
    {(failed || mock) && state.invitationUrl && <div><button type="button" disabled={pending} className="underline" onClick={async () => { try { await navigator.clipboard.writeText(state.invitationUrl!); setCopied(true); } catch { setCopied(false); } }}>Скопировать ссылку</button>{copied && <p role="status">Защищённая ссылка скопирована.</p>}<p className="mt-2 text-sm">Ссылка действует 24 часа с момента выдачи. Повторная отправка заменяет предыдущую ссылку.</p></div>}
    {!participantId && issued && <button name="intent" value="reset" formNoValidate disabled={pending} className="block underline">Пригласить другого участника</button>}
  </form>;
}
