"use client";
import { useActionState, useSyncExternalStore } from "react";
import Link from "next/link";
import { acceptTeamInvitationAction, prepareTeamInvitationAction, switchTeamInvitationAccountAction } from "@/server/team/actions";
import { invitationToken } from "@/server/team/contracts";
function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
export function TeamJoin({ currentEmail, emailConfirmed, hasPending }: { currentEmail: string | null; emailConfirmed: boolean; hasPending: boolean }) {
  const fragment = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  const raw = new URLSearchParams(fragment.slice(1)).get("invitation");
  const token = invitationToken.safeParse(raw).success ? raw! : "";
  const [prepared, prepare, preparing] = useActionState(prepareTeamInvitationAction, {});
  const [accepted, accept, accepting] = useActionState(acceptTeamInvitationAction, {});
  const [switched, switchAccount, switching] = useActionState(switchTeamInvitationAccountAction, {});
  const ready = !token && !prepared.error && (prepared.status === "prepared" || hasPending);
  return <div className="space-y-5">
    <p>Для доступа нужен подтверждённый email, на который вас пригласили. Владелец компании увидит только статус прохождения, без ваших ответов.</p>
    {currentEmail && <div className="space-y-3 rounded-xl border border-border p-4">
      <p>Вы вошли как <strong>{currentEmail}</strong>.</p>
      <p>Если приглашение адресовано другому email, войдите под ним. Новое обычное окно браузера сохраняет текущий аккаунт.</p>
      {ready && <form action={switchAccount}><button disabled={switching || accepting} className="min-h-11 cursor-pointer underline">{switching ? "Выходим…" : "Войти под другим email"}</button></form>}
    </div>}
    {token && !ready ? <form action={prepare} onSubmit={() => { window.history.replaceState(null, "", window.location.pathname); }}>
      <input type="hidden" name="token" value={token} />
      <button disabled={preparing} className="rounded-xl bg-brand px-5 py-3 font-semibold text-white">Продолжить по приглашению</button>
    </form> : ready ? currentEmail ? emailConfirmed ? <form action={accept}>
      <button disabled={accepting || preparing || switching} className="rounded-xl bg-brand px-5 py-3 font-semibold text-white">{accepting ? "Принимаем приглашение…" : "Принять приглашение"}</button>
    </form> : <>
      <p>Сначала подтвердите email текущего аккаунта через письмо, затем вернитесь к приглашению.</p>
      <Link href="/ru/verify-email" className="inline-block min-h-11 underline">Подтвердить email</Link>
    </> : <>
      <Link href="/ru/login?next=team-invitation" className="inline-block rounded-xl bg-brand px-5 py-3 text-white">Войти для участия</Link>
      <p className="text-sm">Если у вас ещё нет аккаунта, зарегистрируйтесь и подтвердите email, затем снова откройте исходную ссылку приглашения.</p>
    </> : <p>Откройте личную ссылку из приглашения. Если срок истёк, попросите владельца компании выпустить новую.</p>}
    {(prepared.error || accepted.error || switched.error) && <p role="alert">{prepared.error || accepted.error || switched.error}</p>}
  </div>;
}
