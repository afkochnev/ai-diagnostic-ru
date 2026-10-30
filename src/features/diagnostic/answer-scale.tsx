"use client";

export const ANSWER_SCALE = [
  { value: 0, display: 1, label: "совершенно неверно" },
  { value: 1, display: 2, label: "скорее неверно" },
  { value: 2, display: 3, label: "частично верно" },
  { value: 3, display: 4, label: "скорее верно" },
  { value: 4, display: 5, label: "совершенно верно" },
] as const;

export function AnswerScaleGuide({ id }: { id?: string }) {
  return <aside id={id} aria-label="Как выбрать оценку" className="rounded-xl bg-tint p-4 text-sm text-muted">
    <p className="font-medium text-brand">Оцените, насколько утверждения верны для вашей компании сейчас.</p>
    <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
      {ANSWER_SCALE.map((point) => <li key={point.value}><span className="font-semibold">{point.display}</span> — {point.label}</li>)}
    </ul>
  </aside>;
}

export function AnswerScale({ name, label, value, invalid, disabled, describedBy, onChange }: {
  name: string;
  label: string;
  value?: number | string | null;
  invalid?: boolean;
  disabled?: boolean;
  describedBy?: string;
  onChange: (value: number) => void;
}) {
  return <div role="radiogroup" aria-label={label} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="mt-5 grid grid-cols-5 gap-2">
    {ANSWER_SCALE.map((point) => <label key={point.value} className="cursor-pointer">
      <input type="radio" name={name} value={point.value} checked={value === point.value} disabled={disabled} onChange={() => onChange(point.value)} aria-label={`${point.display} — ${point.label}`} className="peer sr-only" />
      <span aria-hidden="true" className="flex min-h-12 items-center justify-center rounded-xl border border-line px-2 py-3 text-base font-semibold hover:bg-tint peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">{point.display}</span>
    </label>)}
  </div>;
}
