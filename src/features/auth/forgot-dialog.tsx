"use client";

import { useRef } from "react";
import { AuthForm } from "./auth-form";
import { forgotAction } from "@/server/auth/actions";
import { getMessages } from "@/i18n/messages";

export function ForgotDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const copy = getMessages("ru").auth;
  return <>
    <button className="cursor-pointer text-sm underline" onClick={() => dialog.current?.showModal()}>{copy.forgotLink}</button>
    <dialog ref={dialog} aria-labelledby="forgot-title" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-line bg-white p-6 text-brand shadow-card backdrop:bg-brand/30">
      <div className="mb-6 flex items-start justify-between gap-3"><h2 id="forgot-title" className="text-xl font-semibold">{copy.forgotTitle}</h2><button type="button" className="min-h-10 cursor-pointer text-sm underline" onClick={() => dialog.current?.close()}>{copy.close}</button></div>
      <AuthForm mode="forgot" action={forgotAction} />
    </dialog>
  </>;
}
