"use client";

import { pilotText as tr } from "@/i18n/pilot-copy";
import { useLocale } from "@/i18n/context";
import Link from "next/link";
import { useId, useRef } from "react";

export function AddCompanyLock({ planUrl }: { planUrl: string }) {
  const locale = useLocale();

  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return <>
    <button type="button" aria-haspopup="dialog" aria-label={tr(locale, "Добавить компанию — требуется Advanced")} onClick={() => dialog.current?.showModal()} className="inline-flex min-h-12 flex-wrap items-center justify-center gap-2 rounded-xl border border-line px-5 py-3 font-semibold hover:bg-tint">
      {tr(locale, "Добавить компанию")} <span aria-hidden="true" className="rounded-full bg-tint px-2 py-1 text-xs">Advanced</span>
    </button>
    <dialog ref={dialog} aria-labelledby={titleId} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line bg-white p-6 text-brand shadow-card backdrop:bg-slate-950/35">
      <h2 id={titleId} className="text-xl font-semibold">{tr(locale, "Несколько компаний")}</h2>
      <p className="mt-3 text-muted">{tr(locale, "Несколько компаний доступны на тарифе Advanced.")}</p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Link href={planUrl} className="inline-flex min-h-11 items-center underline">{tr(locale, "Подробнее об Advanced")}</Link>
        <button type="button" onClick={() => dialog.current?.close()} className="min-h-11 rounded-xl border border-line px-4 py-2 font-semibold hover:bg-tint">{tr(locale, "Закрыть")}</button>
      </div>
    </dialog>
  </>;
}
