"use client";

import {useActionState} from "react";
import Link from "next/link";
import {redeemAdvancedPromo} from "@/server/billing/promo-actions";

export function PromoForm({accountId, companyId}: {accountId: string; companyId?: string | null}) {
  const [state, action, pending] = useActionState(redeemAdvancedPromo, {});
  return <form action={action} className="mt-5 max-w-lg">
    <input type="hidden" name="account" value={accountId}/>
    {companyId && <input type="hidden" name="company" value={companyId}/>}
    <label htmlFor="advanced-promo" className="block font-medium">Промокод</label>
    <input id="advanced-promo" name="code" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false}
      required minLength={8} maxLength={64} aria-describedby="advanced-promo-help"
      className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 font-mono uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"/>
    <p id="advanced-promo-help" className="mt-2 text-sm leading-relaxed text-muted">Промокод от организатора тестирования подключает Advanced бесплатно на 30 дней. Банковская карта не нужна.</p>
    {state.error && <p role="alert" className="mt-4 text-red-700">{state.error}</p>}
    {state.success && <p role="status" className="mt-4">{state.success}</p>}
    {state.continueHref ? <Link className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-brand px-5 py-3 font-semibold text-white" href={state.continueHref}>Перейти к компаниям</Link>
      : <button type="submit" disabled={pending} className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{pending ? "Подключаем Advanced…" : "Активировать промокод"}</button>}
  </form>;
}
