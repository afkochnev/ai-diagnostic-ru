import type { TeamReportInputV2 } from "@/server/team/report-v2-contracts";

export function v2Evidence(): TeamReportInputV2 {
  const distributions = [[0,0,4,0,0],[2,0,0,0,2]];
  const stats = (d: number[]) => {
    const mean = d.reduce((a,n,i) => a+n*i,0)/4;
    return { participant_count:4,mean,stddev_pop:Math.sqrt(d.reduce((a,n,i)=>a+n*(i-mean)**2,0)/4),min:d.findIndex(n=>n>0),max:d.findLastIndex(n=>n>0) };
  };
  return {
    participant_count:4,company_context:{company_name:"Синтетический продукт",main_goals:"Предсказуемые релизы"},
    methodology:{version_number:4,algorithm:"individual-weighted-scale-v1",engine_key:"pending_stage_5",engine_version:"1",schema_version:"1"},
    overall:{participant_count:4,mean:50,stddev_pop:10,min:25,max:75,maturity:"Зона развития"},
    blocks:Array.from({length:8},(_,b)=>({title:`Блок ${b+1}`,position:b+1,participant_count:4,mean:b===1?0:b===0?90:50,stddev_pop:b===1?0:10,min:0,max:100})),
    questions:Array.from({length:80},(_,i)=>{
      const b=Math.floor(i/10),distribution=i===0?distributions[0]:i===1?distributions[1]:b===1?[4,0,0,0,0]:[0,0,2,2,0];
      return {question:`Нормализованная практика ${i+1}`,block_title:`Блок ${b+1}`,block_position:b+1,question_position:i%10+1,reverse_score:i===1,normalized_direction:"higher_is_stronger",...stats(distribution),distribution};
    }),
  };
}
