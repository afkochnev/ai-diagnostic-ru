"use client";

import { useActionState, useEffect, useState } from "react";
import type { CompanyProfileState } from "@/validation/company";
import { encodeProfileDraft, profileDraftKey, profileFields, readProfileDraft } from "./profile-draft";

type Reference = { industry_key: string; name: string } | { revenue_key: string; name: string };
type Company = Record<string, string | number | null> | null;
type Props = { action: (state: CompanyProfileState, form: FormData) => Promise<CompanyProfileState>; company: Company; industries: Reference[]; revenues: Reference[]; returnTo?: string; accountId: string; userId: string };
const input = "mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-3 py-3 text-base text-brand";
const fields = [
  ["name", "Название компании", "text"], ["country", "Страна", "text"], ["products", "Продукты", "textarea"], ["customer_segments", "Клиенты / клиентские сегменты", "textarea"], ["sales_channels", "Каналы продаж", "textarea"], ["employee_count", "Число сотрудников", "number"], ["company_age_years", "Возраст компании", "number"], ["management_levels", "Количество уровней управления", "number"], ["key_problems", "Назовите главные ограничения, препятствующие эффективности и динамичному развитию компании", "textarea"], ["main_goals", "Назовите стратегические цели компании в области финансов, достижений на рынке, развития собственных процессов и ресурсов", "textarea"],
] as const;

export function CompanyProfileForm({ action, company, industries, revenues, accountId, userId, returnTo = "/ru/dashboard" }: Props) {
  const initialValues = Object.fromEntries(["revision", ...profileFields].map((key) => [key, String(company?.[key] ?? "")])) as Record<string, string>;
  const draftKey = profileDraftKey(userId, accountId, company ? String(company.id) : undefined);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [draftReady, setDraftReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: CompanyProfileState, form: FormData): Promise<CompanyProfileState> => {
    // A successful action redirects. Failed saves restore the browser draft.
    try { window.localStorage.removeItem(draftKey); } catch { /* Storage may be disabled. */ }
    try {
      const next = await action(previous, form);
      if (next.values) setValues((current) => ({ ...current, ...next.values }));
      return next;
    } catch (error) {
      if (error && typeof error === "object" && "digest" in error && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT")) throw error;
      const submitted = Object.fromEntries(profileFields.map((field) => [field, String(form.get(field) ?? "")])) as Record<string, string>;
      setValues((current) => ({ ...current, ...submitted }));
      return { error: "Не удалось сохранить профиль. Введённые сведения остались в форме. Повторите попытку.", values: submitted };
    }
  }, {});
  const revision = initialValues.revision;
  useEffect(() => {
    let active = true;
    let restored: Record<string, string> | null = null;
    try { restored = readProfileDraft(window.localStorage.getItem(draftKey), revision); } catch { /* Fall back to the server profile. */ }
    queueMicrotask(() => {
      if (!active) return;
      if (restored) { setValues((current) => ({ ...current, ...restored })); setDraftRestored(true); }
      setDraftReady(true);
    });
    return () => { active = false; };
  }, [draftKey, revision]);
  const draftChanged = profileFields.some((field) => values[field] !== initialValues[field]);
  useEffect(() => {
    if (!draftReady || pending) return;
    try {
      if (draftChanged) window.localStorage.setItem(draftKey, encodeProfileDraft(values, revision));
      else window.localStorage.removeItem(draftKey);
      queueMicrotask(() => setDraftSaved(draftChanged));
    } catch { queueMicrotask(() => setDraftSaved(false)); }
  }, [draftReady, draftKey, values, revision, pending, draftChanged]);
  const value = (key: string) => values[key] ?? "";
  const update = (key: string, next: string) => setValues((current) => ({ ...current, [key]: next }));
  const error = (key: string) => state.fieldErrors?.[key as keyof typeof state.fieldErrors];
  return <form action={formAction} className="space-y-5" noValidate>
    <input type="hidden" name="company_id" value={String(company?.id ?? "")} />
    <input type="hidden" name="account_id" value={accountId} />
    <input type="hidden" name="revision" value={String(value("revision"))} />
    <input type="hidden" name="return_to" value={returnTo} />
    {draftRestored && <p role="status" className="rounded-xl bg-tint p-3 text-sm">Восстановлен ваш черновик профиля. <button type="button" className="underline" onClick={() => { try { window.localStorage.removeItem(draftKey); } catch { /* No storage access. */ } setValues(initialValues); setDraftRestored(false); }}>Отменить изменения</button></p>}
    {fields.slice(0, 1).map(([name, label, type]) => <Field key={name} name={name} label={label} type={type} value={value(name)} onChange={update} error={error(name)} />)}
    <label className="block text-sm font-medium">Отрасль<select className={input} name="industry_key" value={value("industry_key")} onChange={(event) => update("industry_key", event.target.value)} required><option value="">Выберите отрасль</option>{industries.map((item) => <option key={String("industry_key" in item ? item.industry_key : "")} value={String("industry_key" in item ? item.industry_key : "")}>{item.name}</option>)}</select>{error("industry_key") && <Error text={error("industry_key")!} />}</label>
    <Field name="products" label="Продукты и услуги" type="textarea" value={value("products")} onChange={update} error={error("products")} hint="Кратко: что вы предлагаете и кому. Достаточно 1–2 предложений." />
    <label className="block text-sm font-medium">Число сотрудников<input className={input} name="employee_count" type="number" min="1" step="1" required value={value("employee_count")} onChange={(event) => update("employee_count", event.target.value)} />{error("employee_count") && <Error text={error("employee_count")!} />}</label>
    {fields.slice(8).map(([name, label, type]) => <Field key={name} name={name} label={label} type={type} value={value(name)} onChange={update} error={error(name)} hint={name === "key_problems" ? "Достаточно нескольких предложений о том, что сейчас мешает компании. В анкете вы сможете уточнить ответ." : "Укажите до трёх главных целей на ближайший год. Их можно уточнить при прохождении диагностики."} />)}
    <details className="rounded-xl border border-line p-4" open={["country", "customer_segments", "sales_channels", "annual_revenue_key", "company_age_years", "management_levels"].some((name) => Boolean(error(name))) || undefined}>
      <summary className="cursor-pointer font-semibold">Дополнительные сведения — необязательно</summary>
      <p className="mt-3 text-sm text-muted">Они помогут точнее учесть контекст компании в отчёте. Их можно добавить позже.</p>
      <div className="mt-5 space-y-5">
        {[...fields.slice(1, 2), ...fields.slice(3, 5), ...fields.slice(6, 8)].map(([name, label, type]) => <Field key={name} name={name} label={label} type={type} value={value(name)} onChange={update} error={error(name)} required={false} />)}
        <label className="block text-sm font-medium">Годовой оборот<select className={input} name="annual_revenue_key" value={value("annual_revenue_key")} onChange={(event) => update("annual_revenue_key", event.target.value)}><option value="">Не указан</option>{revenues.map((item) => <option key={String("revenue_key" in item ? item.revenue_key : "")} value={String("revenue_key" in item ? item.revenue_key : "")}>{item.name}</option>)}</select>{error("annual_revenue_key") && <Error text={error("annual_revenue_key")!} />}</label>
      </div>
    </details>
    {draftSaved && <p role="status" className="text-xs text-muted">Черновик сохраняется в этом браузере на 7 дней.</p>}
    {state.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}
    <button disabled={pending} className="min-h-12 w-full rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{pending ? "Сохранение…" : company ? "Сохранить и перейти в кабинет" : "Сохранить и перейти к диагностике"}</button>
  </form>;
}
function Error({ text }: { text: string }) { return <span className="mt-1 block text-sm text-red-700" role="alert">{text}</span>; }
function Field({ name, label, type, value, onChange, error, hint, required = true }: { name: string; label: string; type: string; value: string; onChange: (name: string, value: string) => void; error?: string; hint?: string; required?: boolean }) { return <label className="block text-sm font-medium">{label}{hint && <span id={`${name}-hint`} className="mt-1 block text-sm font-normal text-muted">{hint}</span>}{type === "textarea" ? <textarea className={`${input} min-h-24`} name={name} required={required} value={value} onChange={(event) => onChange(name, event.target.value)} maxLength={5000} aria-describedby={hint ? `${name}-hint` : undefined} /> : <input className={input} name={name} type={type} required={required} value={value} onChange={(event) => onChange(name, event.target.value)} min={type === "number" ? name === "company_age_years" ? 0 : 1 : undefined} step={type === "number" ? 1 : undefined} maxLength={type === "text" ? 200 : undefined} />}{error && <Error text={error} />}</label>; }
