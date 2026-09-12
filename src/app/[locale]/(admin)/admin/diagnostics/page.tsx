import Link from "next/link";
import { requireAdmin } from "@/server/auth/admin";
import { getAdminDiagnostics, type AdminDiagnosticRow } from "@/server/admin/diagnostics";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const text = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("ru-RU") : "—";
const number = (value: number | null) => value === null ? "—" : String(value).replace(".", ",");

function query(filters: Record<string, unknown>, page?: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page })) if (typeof value === "string" && value) params.set(key, value);
  return `/ru/admin/diagnostics${params.toString() ? `?${params}` : ""}`;
}

function Row({ row }: { row: AdminDiagnosticRow }) {
  return <tr className="border-t border-slate-200 align-top">
    <td className="px-3 py-4"><p className="font-medium text-slate-900">{row.companyName}</p><p className="text-sm text-slate-500">{row.userName}</p></td>
    <td className="px-3 py-4 text-sm">{date(row.createdAt)}<br /><span className="text-slate-500">{row.completedAt ? `Завершена: ${date(row.completedAt)}` : "Не завершена"}</span></td>
    <td className="px-3 py-4 text-sm">{row.status}</td>
    <td className="px-3 py-4 text-sm">{number(row.index)}<br /><span className="text-slate-500">{row.maturity ?? "—"}</span></td>
    <td className="px-3 py-4 text-sm">{row.hasReport ? `Сформирован (${row.reportVersions.join(", ")})` : "Нет отчёта"}</td>
    <td className="px-3 py-4 text-sm">{row.feedbackRating ?? "—"}</td>
    <td className="px-3 py-4 text-sm">{row.consultationStatuses.length ? row.consultationStatuses.join(", ") : "—"}</td>
    <td className="px-3 py-4 text-sm"><Link className="font-semibold text-blue-800 underline" href={`/ru/admin/diagnostics/${row.id}`}>Открыть</Link></td>
  </tr>;
}

export default async function AdminDiagnosticsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const raw = await searchParams;
  const filters = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, text(value)]));
  const result = await getAdminDiagnostics(filters);
  const clean = { q: filters.q, status: filters.status, from: filters.from, to: filters.to, report: filters.report, feedback: filters.feedback, consultation: filters.consultation };
  return <main className="min-h-[70vh] bg-slate-50 py-10 sm:py-14"><div className="mx-auto max-w-7xl px-5 sm:px-8">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><Link href="/ru/admin" className="text-sm underline">Администрирование</Link><h1 className="mt-3 text-3xl font-semibold text-slate-950">Диагностики</h1><p className="mt-2 text-sm text-slate-500">Только просмотр административных проекций.</p></div></div>
    <form method="get" className="mb-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-4"><label className="text-sm">Поиск<input name="q" defaultValue={filters.q} maxLength={100} placeholder="Компания или пользователь" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="text-sm">Статус<select name="status" defaultValue={filters.status ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Все</option>{["in_progress","submitted","scoring","scoring_failed","completed"].map((s)=><option key={s} value={s}>{s}</option>)}</select></label><label className="text-sm">Дата начала с<input type="date" name="from" defaultValue={filters.from} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="text-sm">Дата начала по<input type="date" name="to" defaultValue={filters.to} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="text-sm">AI-отчёт<select name="report" defaultValue={filters.report ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Все</option><option value="yes">Есть</option><option value="no">Нет</option></select></label><label className="text-sm">Обратная связь<select name="feedback" defaultValue={filters.feedback ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Все</option><option value="yes">Есть</option><option value="no">Нет</option></select></label><label className="text-sm">Консультация<select name="consultation" defaultValue={filters.consultation ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Все</option><option value="yes">Есть</option><option value="no">Нет</option></select></label><div className="flex items-end gap-3"><button className="rounded-lg bg-blue-800 px-4 py-2 font-semibold text-white" type="submit">Применить</button><Link className="rounded-lg border border-slate-300 px-4 py-2" href="/ru/admin/diagnostics">Сбросить фильтры</Link></div></form>
    {result.rows.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-slate-600">Диагностики не найдены.</div> : <><div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="min-w-[1060px] w-full text-left"><thead className="bg-slate-100 text-sm"><tr>{["Компания / пользователь","Дата","Статус","Результат","AI-отчёт","Feedback","Консультация","Действие"].map((header)=><th key={header} className="px-3 py-3 font-semibold">{header}</th>)}</tr></thead><tbody>{result.rows.map((row)=><Row key={row.id} row={row} />)}</tbody></table></div><div className="mt-5 flex items-center justify-between text-sm"><span>Страница {result.page} из {result.totalPages} · всего {result.total}</span><div className="flex gap-3">{result.page > 1 && <Link className="rounded-lg border border-slate-300 px-3 py-2" href={query(clean, result.page - 1)}>Назад</Link>}{result.page < result.totalPages && <Link className="rounded-lg border border-slate-300 px-3 py-2" href={query(clean, result.page + 1)}>Далее</Link>}</div></div></>}
  </div></main>;
}
