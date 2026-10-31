import {AdminCard, AdminPage, adminDate} from "@/features/admin/console-ui";
import {CreateAdminPromoForm, RevokeAdminPromoForm} from "@/features/admin/promo-forms";
import {listAdminPromos, promoDateBounds} from "@/server/admin/promos";

export const dynamic = "force-dynamic";
export const metadata = {title: "Промокоды Advanced", robots: {index: false, follow: false}};
export default async function AdminPromosPage() {
  const {rows, readAt} = await listAdminPromos();
  const dates = promoDateBounds();
  return <AdminPage title="Промокоды Advanced">
    <p className="max-w-3xl text-muted">Промокод даёт 30 дней Advanced после активации. Название кампании видно только администратору. Полный код показывается один раз — скопируйте его сразу после создания.</p>
    <AdminCard title="Создать промокод"><CreateAdminPromoForm {...dates}/></AdminCard>
    <AdminCard title="Последние промокоды">
      <p className="mb-5 text-sm text-muted">Показано не более 25 кодов. Отключение запрещает новые активации; уже выданный доступ сохраняется.</p>
      {rows.length ? <ul className="space-y-5">{rows.map(row => {
        const expired = Date.parse(row.redeem_until) <= readAt;
        const available = !row.revoked_at && !expired && row.redemptions < row.max_redemptions;
        const status = row.revoked_at ? "Отозван" : expired ? "Срок истёк" : row.redemptions >= row.max_redemptions ? "Лимит исчерпан" : "Действует";
        return <li key={row.id} className="rounded-xl border border-line p-5">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">{row.label}</h3><p className="mt-2 font-mono text-sm">{row.code_hint}</p></div><p className="rounded-full bg-tint px-3 py-1 text-sm font-semibold">{status}</p></div>
          <dl className="my-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-muted">Активации</dt><dd className="mt-1 font-medium">{row.redemptions} из {row.max_redemptions}</dd></div><div><dt className="text-muted">Приём кода до</dt><dd className="mt-1">{new Date(row.redeem_until).toLocaleString("ru-RU", {timeZone: "UTC", dateStyle: "medium", timeStyle: "short"})} UTC</dd></div><div><dt className="text-muted">Создан</dt><dd className="mt-1">{adminDate(row.created_at)}</dd></div>{row.revoked_at && <div><dt className="text-muted">Отозван</dt><dd className="mt-1">{adminDate(row.revoked_at)}</dd></div>}</dl>
          {available && <RevokeAdminPromoForm promoId={row.id}/>}
        </li>;
      })}</ul> : <p className="text-muted">Промокодов пока нет.</p>}
    </AdminCard>
  </AdminPage>;
}
