import Link from 'next/link';
import {getAccountPlan} from '@/server/entitlements';
import {listTeams} from '@/server/team/service';
import {teamFoundationEnabled} from '@/server/team/capabilities';
import {acquisitionEnabled} from '@/server/acquisition/contracts';
import {MilestoneView} from './tracking';
export function teamConversionDestination(companyId:string,advanced:boolean,activeId?:string){
 return activeId?`/ru/companies/${companyId}/teams/${activeId}`:advanced?`/ru/companies/${companyId}/diagnostics?new=1&type=team#team-create`:`/ru/companies/${companyId}/team-explainer`;
}
export async function TeamOffer({companyId,accountId,diagnosticId,weakBlocks=[],surface='individual_report'}:{companyId:string;accountId:string;diagnosticId?:string;weakBlocks?:string[];surface?:'individual_report'|'dashboard'|'diagnostics_hub'}){
 if(!acquisitionEnabled())return null;
 const [plan,teams]=await Promise.all([getAccountPlan(accountId),teamFoundationEnabled()?listTeams(companyId):Promise.resolve([])]);
 const active=teams.find(t=>t.status==='open');
 const label=active?'Открыть командную диагностику':plan.entitlements.team_diagnostics?'Создать командную диагностику':'Провести командную диагностику';
 return <section className="mt-10 rounded-2xl border border-line bg-white p-6 sm:p-8" aria-labelledby={`team-offer-${surface}`}><MilestoneView name="advanced_offer_viewed" companyId={companyId} diagnosticId={diagnosticId??null} surface={surface}/><h2 id={`team-offer-${surface}`} className="text-2xl font-semibold">Проверьте диагноз командой</h2><p className="mt-4 leading-relaxed text-muted">Этот отчёт сформирован на основе вашей оценки компании. Следующий уровень анализа — получить независимые конфиденциальные ответы нескольких руководителей и сравнить агрегированную картину.</p>{weakBlocks.length>0&&<p className="mt-4 leading-relaxed">Одна из областей с наиболее низкой оценкой — {weakBlocks[0]}. Командная диагностика поможет проверить, одинаково ли руководители видят состояние этой области.</p>}<ul className="mt-5 grid gap-2 sm:grid-cols-2">{['Средняя оценка команды','Зоны согласия и расхождений','Анонимные качественные сигналы','Командный AI-отчёт и PDF'].map(t=><li key={t}>• {t}</li>)}</ul><Link href={teamConversionDestination(companyId,plan.entitlements.team_diagnostics,active?.id)} className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-5 py-3 text-center font-semibold text-white">{label}</Link>{!active&&!plan.entitlements.team_diagnostics&&<p className="mt-3 text-sm text-muted">Доступно в Advanced</p>}</section>;
}
