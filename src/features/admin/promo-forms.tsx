"use client";
import {useActionState} from "react";
import {createAdminPromo, revokeAdminPromo} from "@/server/admin/promo-actions";

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
    {state.code && <div role="status" className="rounded-xl bg-tint p-5"><p className="font-semibold">{state.success}</p><label className="mt-4 block text-sm">Полный промокод<input readOnly value={state.code} onFocus={event => event.currentTarget.select()} className={`${field} font-mono text-base tracking-wide`} aria-describedby="promo-copy-help"/></label><p id="promo-copy-help" className="mt-3 text-sm text-muted">Скопируйте код до ухода со страницы. В списке останется только его короткая подсказка.</p></div>}
    <button disabled={pending} className="min-h-12 rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-50">{pending ? "Создаём промокод…" : "Создать промокод"}</button>
  </form>;
}

export function RevokeAdminPromoForm({promoId}: {promoId: string}) {
  const [state, action, pending] = useActionState(revokeAdminPromo, {});
  return <form action={action}><input type="hidden" name="promo_id" value={promoId}/><button disabled={pending} className="min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:bg-tint disabled:opacity-50">{pending ? "Отключаем…" : "Отключить новые активации"}</button>{state.error && <p role="alert" className="mt-3 text-sm text-red-800">{state.error}</p>}{state.success && <p role="status" className="mt-3 text-sm">{state.success}</p>}</form>;
}
