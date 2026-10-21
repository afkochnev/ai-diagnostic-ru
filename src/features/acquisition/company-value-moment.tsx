import Link from 'next/link';
import {createAuthClient} from '@/server/supabase/server';
import {acquisitionEnabled} from '@/server/acquisition/contracts';
import type {getLatestDiagnostics} from '@/server/diagnostic/service';
import {PdfDownloadButton} from '@/features/pdf/pdf-download-button';
import {TeamOffer} from './team-offer';
export async function CompanyValueMoment({company,diagnostics}:{company:{id:string;account_id:string};diagnostics:Awaited<ReturnType<typeof getLatestDiagnostics>>}){
 if(!acquisitionEnabled())return null;const latest=diagnostics.find(d=>d.diagnostic.status==='completed'&&d.result);if(!latest?.result)return null;
 const {data:report}=await (await createAuthClient()).from('ai_reports').select('id').eq('diagnostic_id',latest.diagnostic.id).eq('status','completed').order('version',{ascending:false}).limit(1).maybeSingle();
 if(!report)return null;
 return <section className="mt-8"><div className="rounded-2xl border border-line bg-white p-6"><h2 className="text-2xl font-semibold">Ваш последний результат</h2><p className="mt-3">Индекс управляемости: {String(latest.result.display_manageability_index).replace('.',',')} из 100 · {latest.result.maturity_label}</p><Link href={`/ru/diagnostics/${latest.diagnostic.id}/result`} className="mt-4 inline-block underline">Открыть полный отчёт</Link><div className="mt-4"><PdfDownloadButton reportId={report.id}/></div></div><TeamOffer companyId={company.id} accountId={company.account_id} diagnosticId={latest.diagnostic.id} surface="dashboard"/></section>;
}
