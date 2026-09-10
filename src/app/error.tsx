"use client";

import { defaultLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { errors } = getMessages(defaultLocale);
  return <main id="main-content" className="mx-auto max-w-xl px-5 py-20"><h1 className="section-title">{errors.title}</h1><p className="my-6">{errors.description}</p><button onClick={reset} className="min-h-12 cursor-pointer rounded-xl bg-brand px-6 py-3 text-white">{errors.retry}</button></main>;
}
