import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";

const sections = [
  "Диагностики",
  "Компании и пользователи",
  "Заявки на консультацию",
  "Обратная связь",
  "Метрики",
] as const;

export function AdminShell() {
  return (
    <main id="main-content" className="min-h-[70vh] bg-slate-50 py-10 sm:py-14">
      <Container>
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-500">Панель управления</p>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Администрирование</h1>
            </div>
            <Link className="text-sm font-medium text-blue-800 underline-offset-4 hover:underline" href="/ru/dashboard">
              Вернуться в кабинет
            </Link>
          </div>
          <Card>
            <nav aria-label="Разделы администрирования" className="grid gap-3 sm:grid-cols-2">
              {sections.map((section) => (
                section === "Диагностики" ? <Link key={section} href="/ru/admin/diagnostics" className="rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
                  <p className="font-medium text-slate-900">{section}</p><p className="mt-1 text-sm text-slate-500">Просмотр завершённых и текущих диагностик.</p>
                </Link> : section === "Компании и пользователи" ? <Link key={section} href="/ru/admin/companies" className="rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300">
                  <p className="font-medium text-slate-900">{section}</p><p className="mt-1 text-sm text-slate-500">Просмотр компаний и пользователей.</p>
                </Link> : section === "Заявки на консультацию" ? <Link key={section} href="/ru/admin/leads" className="rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300"><p className="font-medium text-slate-900">{section}</p><p className="mt-1 text-sm text-slate-500">Только просмотр заявок и уведомлений.</p></Link> : section === "Обратная связь" ? <Link key={section} href="/ru/admin/feedback" className="rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300"><p className="font-medium text-slate-900">{section}</p><p className="mt-1 text-sm text-slate-500">Просмотр отзывов пользователей.</p></Link> : section === "Метрики" ? <Link key={section} href="/ru/admin/metrics" className="rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300"><p className="font-medium text-slate-900">{section}</p><p className="mt-1 text-sm text-slate-500">Диагностическая воронка и агрегаты.</p></Link> : <div key={section} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="font-medium text-slate-900">{section}</p><p className="mt-1 text-sm text-slate-500">Раздел будет доступен на следующем этапе разработки.</p>
                </div>
              ))}
            </nav>
          </Card>
        </div>
      </Container>
    </main>
  );
}
