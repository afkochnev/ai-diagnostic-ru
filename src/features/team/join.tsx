"use client";
import { useActionState, useSyncExternalStore } from "react";
import Link from "next/link";
import { acceptTeamInvitationAction, prepareTeamInvitationAction } from "@/server/team/actions";
import { invitationToken } from "@/server/team/contracts";
function subscribe(listener: () => void) {
  window.addEventListener("hashchange",listener);
  return () => window.removeEventListener("hashchange",listener);
}
export function TeamJoin({ signedIn, hasPending }: { signedIn: boolean; hasPending: boolean }) {
  const fragment = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  const raw = new URLSearchParams(fragment.slice(1)).get("invitation");
  const token = invitationToken.safeParse(raw).success ? raw! : "";
  const [prepared, prepare, preparing] = useActionState(prepareTeamInvitationAction, {});
  const [accepted, accept, accepting] = useActionState(acceptTeamInvitationAction, {});
  const ready = !token && !prepared.error && (prepared.status === "prepared" || hasPending);
  return <div className="space-y-5"><p>Для доступа нужен подтверждённый email, на который вас пригласили. Владелец компании увидит только статус прохождения, без ваших ответов.</p>{token && !ready ? <form action={prepare} onSubmit={() => { window.history.replaceState(null,"",window.location.pathname); }}><input type="hidden" name="token" value={token} /><button disabled={preparing} className="rounded-xl bg-brand px-5 py-3 font-semibold text-white">Продолжить по приглашению</button></form> : ready ? signedIn ? <form action={accept}><button disabled={accepting || preparing} className="rounded-xl bg-brand px-5 py-3 font-semibold text-white">Принять приглашение</button></form> : <><Link href="/ru/login?next=team-invitation" className="inline-block rounded-xl bg-brand px-5 py-3 text-white">Войти для участия</Link><p className="text-sm">Если у вас ещё нет аккаунта, зарегистрируйтесь и подтвердите email, затем снова откройте исходную ссылку приглашения.</p></> : <p>Откройте личную ссылку из приглашения. Если срок истёк, попросите владельца компании выпустить новую.</p>}{(prepared.error || accepted.error) && <p role="alert">{prepared.error || accepted.error}</p>}</div>;
}
