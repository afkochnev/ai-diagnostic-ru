import Link from "next/link";
import { getAccountPlan } from "@/server/entitlements";
import { listTeams } from "@/server/team/service";
import { teamFoundationEnabled } from "@/server/team/capabilities";
import { acquisitionEnabled } from "@/server/acquisition/contracts";
import { requestAdvanced } from "@/server/acquisition/conversion";
import { MilestoneView } from "./tracking";

const button = "mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-5 py-3 text-center font-semibold text-white";

export async function TeamOffer({ companyId, accountId, diagnosticId, weakBlocks = [], surface = "individual_report" }: {
  companyId: string;
  accountId: string;
  diagnosticId?: string;
  weakBlocks?: string[];
  surface?: "individual_report" | "dashboard" | "diagnostics_hub";
}) {
  if (!acquisitionEnabled()) return null;
  const { entitlements } = await getAccountPlan(accountId);
  const active = entitlements.team_diagnostics && teamFoundationEnabled()
    ? (await listTeams(companyId)).find(team => team.status === "open")
    : undefined;
  const company = `/ru/companies/${companyId}`;

  return <section className="mt-10 rounded-2xl border border-line bg-white p-6 sm:p-8" aria-labelledby={`team-offer-${surface}`}>
    <MilestoneView name="advanced_offer_viewed" companyId={companyId} diagnosticId={diagnosticId ?? null} surface={surface} />
    <h2 id={`team-offer-${surface}`} className="text-2xl font-semibold">Проверьте диагноз командой</h2>
    <p className="mt-4 leading-relaxed text-muted">Этот отчёт сформирован на основе вашей оценки компании. Следующий уровень анализа — получить независимые конфиденциальные ответы нескольких руководителей и сравнить агрегированную картину.</p>
    {weakBlocks.length > 0 && <p className="mt-4 leading-relaxed">Одна из областей с наиболее низкой оценкой — {weakBlocks[0]}. Командная диагностика поможет проверить, одинаково ли руководители видят состояние этой области.</p>}
    <ul className="mt-5 grid gap-2 sm:grid-cols-2">{["Средняя оценка команды", "Зоны согласия и расхождений", "Анонимные качественные сигналы", "Командный AI-отчёт и PDF"].map(text => <li key={text}>• {text}</li>)}</ul>
    {entitlements.team_diagnostics ? <Link href={active ? `${company}/teams/${active.id}` : `${company}/diagnostics?new=1&type=team#team-create`} className={button}>
      {active ? "Открыть командную диагностику" : "Создать командную диагностику"}
    </Link> : <>
      <form action={requestAdvanced.bind(null, companyId, surface)}>
        <button className={button} type="submit">Провести командную диагностику</button>
      </form>
      <p className="mt-3 text-sm text-muted">Доступно в Advanced. Подключите тариф или введите промокод.</p>
    </>}
  </section>;
}
