"use client";

import { useActionState, useState } from "react";
import type { CompanyProfileState } from "@/validation/company";

type Reference = { industry_key: string; name: string } | { revenue_key: string; name: string };
type Company = Record<string, string | number> | null;
type Props = { action: (state: CompanyProfileState, form: FormData) => Promise<CompanyProfileState>; company: Company; industries: Reference[]; revenues: Reference[]; returnTo?: string };
const input = "mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-3 py-3 text-base text-brand";
const fields = [
  ["name", "Название компании", "text"], ["country", "Страна", "text"], ["products", "Продукты", "textarea"], ["customer_segments", "Клиенты / клиентские сегменты", "textarea"], ["sales_channels", "Каналы продаж", "textarea"], ["employee_count", "Число сотрудников", "number"], ["company_age_years", "Возраст компании", "number"], ["management_levels", "Количество уровней управления", "number"], ["key_problems", "Назовите главные ограничения, препятствующие эффективности и динамичному развитию компании", "textarea"], ["main_goals", "Назовите стратегические цели компании в области финансов, достижений на рынке, развития собственных процессов и ресурсов", "textarea"],
] as const;

export function CompanyProfileForm({ action, company, industries, revenues, returnTo = "/ru/dashboard" }: Props) {
  const initialValues = Object.fromEntries(["revision", "name", "industry_key", "country", "products", "customer_segments", "sales_channels", "employee_count", "annual_revenue_key", "company_age_years", "management_levels", "key_problems", "main_goals"].map((key) => [key, String(company?.[key] ?? "")])) as Record<string, string>;
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [state, formAction, pending] = useActionState(async (previous: CompanyProfileState, form: FormData) => {
    const next = await action(previous, form);
    if (next.values) setValues((current) => ({ ...current, ...next.values }));
    return next;
  }, {});
  const value = (key: string) => values[key] ?? "";
  const update = (key: string, next: string) => setValues((current) => ({ ...current, [key]: next }));
  const error = (key: string) => state.fieldErrors?.[key as keyof typeof state.fieldErrors];
  return <form action={formAction} className="space-y-5" noValidate>
    <input type="hidden" name="revision" value={String(value("revision"))} />
    <input type="hidden" name="return_to" value={returnTo} />
    {fields.slice(0, 1).map(([name, label, type]) => <Field key={name} name={name} label={label} type={type} value={value(name)} onChange={update} error={error(name)} />)}
    <label className="block text-sm font-medium">Отрасль<select className={input} name="industry_key" value={value("industry_key")} onChange={(event) => update("industry_key", event.target.value)} required><option value="">Выберите отрасль</option>{industries.map((item) => <option key={String("industry_key" in item ? item.industry_key : "")} value={String("industry_key" in item ? item.industry_key : "")}>{item.name}</option>)}</select>{error("industry_key") && <Error text={error("industry_key")!} />}</label>
    {fields.slice(1, 2).map(([name, label, type]) => <Field key={name} name={name} label={label} type={type} value={value(name)} onChange={update} error={error(name)} />)}
    {fields.slice(2, 5).map(([name, label, type]) => <Field key={name} name={name} label={label} type={type} value={value(name)} onChange={update} error={error(name)} />)}
    <label className="block text-sm font-medium">Число сотрудников<input className={input} name="employee_count" type="number" min="1" step="1" required value={value("employee_count")} onChange={(event) => update("employee_count", event.target.value)} />{error("employee_count") && <Error text={error("employee_count")!} />}</label>
    <label className="block text-sm font-medium">Годовой оборот<select className={input} name="annual_revenue_key" value={value("annual_revenue_key")} onChange={(event) => update("annual_revenue_key", event.target.value)} required><option value="">Выберите диапазон</option>{revenues.map((item) => <option key={String("revenue_key" in item ? item.revenue_key : "")} value={String("revenue_key" in item ? item.revenue_key : "")}>{item.name}</option>)}</select>{error("annual_revenue_key") && <Error text={error("annual_revenue_key")!} />}</label>
    {fields.slice(6).map(([name, label, type]) => <Field key={name} name={name} label={label} type={type} value={value(name)} onChange={update} error={error(name)} />)}
    {state.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}
    <button disabled={pending} className="min-h-12 w-full rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{pending ? "Сохранение…" : "Сохранить и перейти в кабинет"}</button>
  </form>;
}
function Error({ text }: { text: string }) { return <span className="mt-1 block text-sm text-red-700" role="alert">{text}</span>; }
function Field({ name, label, type, value, onChange, error }: { name: string; label: string; type: string; value: string; onChange: (name: string, value: string) => void; error?: string }) { return <label className="block text-sm font-medium">{label}{type === "textarea" ? <textarea className={`${input} min-h-28`} name={name} required value={value} onChange={(event) => onChange(name, event.target.value)} /> : <input className={input} name={name} type={type} required value={value} onChange={(event) => onChange(name, event.target.value)} min={type === "number" ? name === "company_age_years" ? 0 : 1 : undefined} step={type === "number" ? 1 : undefined} />}{error && <Error text={error} />}</label>; }
