/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useState } from "react";
import { ReportGenerationProgress } from "./report-generation-progress";
import { ReportRegenerationButton } from "./report-regeneration-button";
const sections = [["Краткое резюме","summary"],["Главный управленческий диагноз","main_diagnosis"],["Что означает текущий индекс управляемости","manageability_index_text"],["Сильные стороны системы управления","strengths"],["Ключевые проблемные зоны","key_problem_zones"],["Главное ограничение роста","growth_constraint"],["Риски, если ничего не менять","implementation_risks"],["Первые действия руководителя","first_actions"],["План на 30 дней","plan_30_days"],["План на 60 дней","plan_60_days"],["План на 90 дней","plan_90_days"],["Следующий рекомендуемый шаг","next_step"]] as const;
export function AIReportSection({diagnosticId,initial}:{diagnosticId:string;initial:any}) {
  const [report]=useState<any>(initial);
  const [failed,setFailed]=useState(report?.status==="failed");
  const [connectionIssue,setConnectionIssue]=useState(false);
  const [closed,setClosed]=useState(false);
  const [checks,setChecks]=useState(0);
  useEffect(()=>{
    if(report?.status==='completed'||report?.status==='failed')return;
    let active=true;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{
      try {
        const response=await fetch(`/api/diagnostics/${diagnosticId}/ai`,{method:'GET',cache:'no-store'});
        const body=await response.json().catch(()=>({}));
        if(!active)return;
        if(!response.ok)throw new Error("status_unavailable");
        setConnectionIssue(false);
        if(body.status==='failed'){setFailed(true);return;}
        if(body.status==='completed'){window.location.reload();return;}
        // Elapsed time is not a generation failure. Keep reading the existing job.
        timer=setTimeout(poll,1500);
      } catch {if(active)setConnectionIssue(true);}
    };
    void poll();
    return()=>{active=false;if(timer)clearTimeout(timer);};
  },[diagnosticId,report,checks]);
  if(failed)return <>{!closed&&<ReportGenerationProgress state="failed" onClose={()=>setClosed(true)} />}<section id="individual-ai-report" className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-6"><h2 className="text-xl font-semibold">Не удалось подготовить AI-отчёт</h2><p className="mt-2 text-sm">Результаты диагностики сохранены. Можно повторить формирование отчёта.</p>{report?.status!=="failed"&&<ReportRegenerationButton diagnosticId={diagnosticId} failed />}</section></>;
  const generating=!report||report.status==='queued'||report.status==='generating';
  if(generating)return <>{!closed&&!connectionIssue&&<ReportGenerationProgress state="generating" onClose={()=>setClosed(true)} />}<section id="individual-ai-report" className="mt-8 rounded-2xl bg-tint p-6"><h2 className="text-xl font-semibold">Готовим аналитический AI-отчёт</h2><p className="mt-2 text-sm text-muted">Индекс и результаты блоков уже рассчитаны. Отчёт формируется в фоновом режиме. Можно вернуться к нему из кабинета.</p>{connectionIssue&&<p role="status" className="mt-3 text-sm">Сейчас не удалось проверить готовность. Это не означает, что подготовка отчёта остановилась.</p>}<button type="button" onClick={()=>{setClosed(true);setConnectionIssue(false);setChecks(checks+1);}} className="mt-4 rounded-xl border border-line px-4 py-3 font-semibold">Проверить статус</button></section></>;
  const content=report.structured_content??{};
  return <section id="individual-ai-report" className="mt-8 scroll-mt-6 space-y-5"><h2 className="text-2xl font-semibold">Аналитический AI-отчёт</h2><details className="rounded-xl bg-tint p-4"><summary className="cursor-pointer font-semibold">Разделы отчёта</summary><nav aria-label="Разделы индивидуального AI-отчёта" className="mt-3 grid gap-2 sm:grid-cols-2">{sections.map(([title,key])=><a key={key} href={`#individual-report-${key}`} className="underline">{title}</a>)}</nav></details>{sections.map(([title,key],index)=><article id={`individual-report-${key}`} key={key} className="scroll-mt-6 rounded-2xl border border-line bg-white p-6"><h3 className="text-lg font-semibold">{index+1}. {title}</h3>{Array.isArray(content[key])?<ul className="mt-3 list-disc space-y-2 pl-5">{content[key].map((item:string,i:number)=><li key={i}>{item}</li>)}</ul>:<p className="mt-3 whitespace-pre-wrap leading-relaxed">{content[key]}</p>}</article>)}</section>;
}
