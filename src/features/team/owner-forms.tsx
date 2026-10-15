"use client";
import { useActionState } from "react";
import { createTeamAction, inviteTeamAction, renewTeamInvitationAction } from "@/server/team/actions";
const input = "mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-3 py-3";
const button = "mt-4 min-h-12 rounded-xl bg-brand px-5 py-3 font-semibold text-white disabled:opacity-50";
export function CreateTeamForm({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState(createTeamAction, {});
  return <form action={action}><input type="hidden" name="companyId" value={companyId} /><label>Название командной диагностики<input name="title" required minLength={2} maxLength={200} className={input} /></label>{state.error && <p role="alert">{state.error}</p>}<button className={button} disabled={pending}>Создать командную диагностику</button></form>;
}
export function InviteTeamForm({ teamId, participantId }: { teamId: string; participantId?: string }) {
  const [state, action, pending] = useActionState(participantId ? renewTeamInvitationAction : inviteTeamAction, {});
  return <form action={action} className="space-y-3"><input type="hidden" name="teamId" value={teamId} />{participantId ? <input type="hidden" name="participantId" value={participantId} /> : <><label className="block">Имя участника<input name="displayName" required maxLength={100} className={input} /></label><label className="block">Email участника<input name="email" type="email" required maxLength={254} className={input} /></label></>}{state.error && <p role="alert">{state.error}</p>}<button disabled={pending} className={button}>{participantId ? "Выпустить новую ссылку" : "Пригласить участника"}</button>{state.invitationUrl && <div role="status" className="rounded-xl bg-tint p-4"><p>{state.emailStatus === "mock" ? "Приглашение создано. На staging письмо не отправляется: передайте участнику ссылку ниже." : state.emailStatus === "sent" ? "Приглашение отправлено на указанный email." : "Приглашение создано, но письмо отправить не удалось. Передайте участнику ссылку ниже."}</p><label className="mt-3 block">Личная ссылка приглашения<input readOnly value={state.invitationUrl} className={input} onFocus={(e) => e.currentTarget.select()} /></label><p className="mt-2 text-sm">Действует 7 дней и требует входа с приглашённым email. Новая ссылка заменяет предыдущую.</p></div>}</form>;
}
