"use client";
import {useActionState} from "react";
import {changeAdminPlan} from "@/server/admin/plan-actions";
export function AdminPlanForm({accountId,current}:{accountId:string;current:"free"|"advanced"}){
 const [state,action,pending]=useActionState(changeAdminPlan,{});
 return <section className="rounded-2xl border border-line bg-white p-6"><h2 className="text-xl font-semibold">Изменить тариф</h2><p className="mt-2">Текущий тариф: <strong>{current==="advanced"?"Advanced":"Free"}</strong></p>
 {current==="advanced"&&<div className="my-4 rounded-xl bg-tint p-4 text-sm"><p>При переходе на Free сохраняются дополнительные компании, командные диагностики, результаты, отчёты и PDF. Уже приглашённые участники смогут завершить анкету.</p><p className="mt-2">Создание дополнительных компаний, новых командных диагностик и новых участников станет недоступно.</p></div>}
 <form action={action} className="mt-4 space-y-4"><input type="hidden" name="account" value={accountId}/><input type="hidden" name="expected" value={current}/>
 <label className="block">Новый тариф<select name="target" defaultValue={current==="free"?"advanced":"free"} className="mt-1 block rounded-lg border p-2"><option value="free">Free</option><option value="advanced">Advanced</option></select></label>
 <label className="block">Причина изменения<textarea name="reason" required minLength={3} maxLength={500} rows={3} className="mt-1 block w-full rounded-lg border p-3"/></label>
 <label className="flex items-start gap-2"><input type="checkbox" name="confirm" required className="mt-1"/><span>Подтверждаю изменение тарифа этого аккаунта. Причина и моя учётная запись будут сохранены в журнале.</span></label>
 {state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}
 <button disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-white disabled:opacity-50">{pending?"Сохраняем…":"Подтвердить изменение тарифа"}</button></form></section>;
}
