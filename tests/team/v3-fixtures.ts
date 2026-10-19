import { v2Evidence } from "./v2-fixtures";
import { mainTeamReportInputV3 } from "@/server/team/report-v3-contracts";
import { mockTeamReportV3, mockTeamSynthesisV3 } from "@/server/team/report-v3-provider";
export function meanEvidence(dispersed=false) {
  const e=v2Evidence();
  e.blocks=e.blocks.map((b,i)=>({...b,mean:i===0?75:i===1?25:50,stddev_pop:dispersed?20:0,min:dispersed?0:i===0?75:i===1?25:50,max:dispersed?100:i===0?75:i===1?25:50}));
  e.questions=e.questions.map(q=>{
    const value=q.block_position===1?3:q.block_position===2?1:2;
    const distribution=dispersed?(value===3?[0,0,2,0,2]:value===1?[2,0,2,0,0]:[2,0,0,0,2]):Array.from({length:5},(_,i)=>i===value?4:0);
    return {...q,mean:value,stddev_pop:Math.sqrt(distribution.reduce((n,c,i)=>n+c*(i-value)**2,0)/4),min:distribution.findIndex(x=>x>0),max:distribution.findLastIndex(x=>x>0),distribution};
  });
  e.overall={...e.overall,mean:50,stddev_pop:dispersed?20:0,min:dispersed?0:50,max:dispersed?100:50};
  return e;
}
export function qualitativeFixture(kind="ownership") {
  const e=meanEvidence();const texts=kind==="ownership"?["Задача многократно возвращается на утверждение сверху.","При передаче процесса владельцу не хватает полномочий.","Согласование решения отнимает значительную часть цикла."]:["Метрики результата не определяют корректирующее действие.","Данные доступны с задержкой и мешают проверять план.","Показатели не используются при выборе следующих шагов."];
  return {company_context:e.company_context,block_aggregates:e.blocks,groups:[{question:"Опишите главную управленческую проблему",question_position:1,block_title:"Общая информация",response_count:3,texts,relevant_block:null}]};
}
export const reportFixture=()=>mockTeamReportV3(mainTeamReportInputV3(meanEvidence(),mockTeamSynthesisV3(qualitativeFixture())));
