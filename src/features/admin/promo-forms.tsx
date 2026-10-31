"use client";
import {useActionState, useId, useState} from "react";
import {createAdminPromo, deleteAdminPromo, revokeAdminPromo} from "@/server/admin/promo-actions";

const field = "mt-2 block min-h-12 w-full rounded-xl border border-line bg-white px-3 py-3";
export function CreateAdminPromoForm({minimum, maximum, initial}: {minimum: string; maximum: string; initial: string}) {
  const [state, action, pending] = useActionState(createAdminPromo, {});
  return <form action={action} className="space-y-5">
    <label className="block font-medium">Название кампании<input name="label" required minLength={3} maxLength={100} className={field} placeholder="Например, участники вебинара"/></label>
    <div className="grid gap-5 sm:grid-cols-2">
      <label className="block font-medium">Лимит активаций<input name="max_redemptions" type="number" min={1} max={1000} step={1} defaultValue={50} required className={field}/></label>
      <label className="block font-medium">Активировать до, включительно<input name="redeem_until" type="date" min={minimum} max={maximum} defaultValue={initial} required className={field}/><span className="mt-2 block text-xs font-normal text-muted">До конца выбранной даты по UTC. Каждая активация даёт 30 дней Advanced.</span></label>
    </div>
    {state.error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{state.error}</p>}
    {state.success && <p role="status" className="rounded-xl bg-tint p-5 font-semibold">{state.success}</p>}
    <button disabled={pending} className="min-h-12 rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-50">{pending ? "Создаём промокод…" : "Создать промокод"}</button>
  </form>;
}

export function AdminPromoCode({code}: {code: string}) {
  const id = useId();
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setMessage("Промокод скопирован.");
    } catch {
      setMessage("Нажмите на код, чтобы выделить его, и скопируйте вручную.");
    }
  }
  return <div className="mt-4">
    <label htmlFor={id} className="block text-sm font-medium">Полный промокод</label>
    <div className="flex flex-wrap items-center gap-3">
      <input id={id} readOnly value={code} onFocus={event => event.currentTarget.select()} className={`${field} min-w-0 flex-1 font-mono text-sm tracking-wide`} style={{minWidth: "min(100%, 19rem)"}}/>
      <button type="button" onClick={copy} className="mt-2 min-h-12 rounded-xl border border-line bg-white px-4 py-3 text-sm font-semibold hover:bg-tint">Скопировать</button>
    </div>
    {message && <p role="status" className="mt-2 text-sm text-muted">{message}</p>}
  </div>;
}

export function RevokeAdminPromoForm({promoId}: {promoId: string}) {
  const [state, action, pending] = useActionState(revokeAdminPromo, {});
  return <form action={action}><input type="hidden" name="promo_id" value={promoId}/><button disabled={pending} className="min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:bg-tint disabled:opacity-50">{pending ? "Отключаем…" : "Отключить новые активации"}</button>{state.error && <p role="alert" className="mt-3 text-sm text-red-800">{state.error}</p>}{state.success && <p role="status" className="mt-3 text-sm">{state.success}</p>}</form>;
}

export function DeleteAdminPromoForm({promoId}: {promoId: string}) {
  const [state, action, pending] = useActionState(deleteAdminPromo, {});
  const [confirming, setConfirming] = useState(false);
  return <form action={action}>
    <input type="hidden" name="promo_id" value={promoId}/>
    {confirming ? <div className="rounded-xl bg-tint p-4">
      <p className="text-sm">Удалить промокод из списка? Новые активации прекратятся. Уже выданный доступ сохранится.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button disabled={pending} className="min-h-11 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-50">{pending ? "Удаляем…" : "Удалить из списка"}</button>
        <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:bg-white disabled:opacity-50">Отмена</button>
      </div>
    </div> : <button type="button" onClick={() => setConfirming(true)} className="min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-red-800 hover:bg-tint">Удалить промокод</button>}
    {state.error && <p role="alert" className="mt-3 text-sm text-red-800">{state.error}</p>}
    {state.success && <p role="status" className="mt-3 text-sm">{state.success}</p>}
  </form>;
}
