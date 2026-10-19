import { mainTeamReportInputV2, parseQualitativeInputV2 } from "../report-v2-contracts";
import { normalizePrivacyText } from "../synthesis-privacy";
import { systemFunctions } from "./system-assessment";

export const emptySynthesis = {themes:[],strengths:[],problem_patterns:[],growth_constraints:[],risks:[],opportunities:[],alignment_signals:[],divergence_signals:[],contradictions:[],management_implications:[],discussion_topics:[]};
export function buildDossier(aggregates:unknown,qualitative:unknown) {
  const a=mainTeamReportInputV2(aggregates,emptySynthesis),q=parseQualitativeInputV2(qualitative);
  if(JSON.stringify(a.company_context)!==JSON.stringify(q.company_context) || q.groups.some(g=>g.response_count>a.participant_count) || new Set(q.groups.map(g=>g.question_position)).size!==q.groups.length) throw new Error("team_numeric_integrity");
  const blockPositions=new Set(a.blocks.map(b=>b.position));
  if(a.questions.some(x=>!blockPositions.has(x.block_position)))throw new Error("team_numeric_integrity");
  // Display evidence identifiers refer to facts, never to people or linked respondent vectors.
  const facts=[{id:"overall.mean",value:a.overall.mean},{id:"overall.maturity",value:a.overall.maturity},
    ...a.blocks.map(b=>({id:`block.${b.position}.mean`,value:b.mean})),
    ...a.questions.map(x=>({id:`question.${x.block_position}.${x.question_position}.mean`,value:x.mean})),
    ...Object.entries(a.company_context).filter(([,v])=>v!==null&&v!==undefined).map(([k,value])=>({id:`context.${k}`,value})),
  ];
  const primary={participant_count:a.participant_count,company_context:a.company_context,methodology:a.methodology,
    overall_mean:a.overall.mean,maturity:a.overall.maturity,
    blocks:a.blocks.map(({position,title,mean})=>({position,title,mean})),
    questions:a.questions.map(({question,block_position,question_position,mean,normalized_direction})=>({question,block_position,question_position,mean,normalized_direction})),facts,
    system_frame:{kind:"analytical_framework_not_observed_company_facts",scope:"Assess the whole management system before choosing a local intervention",dimensions:[...a.blocks].sort((x,y)=>x.position-y.position).map((b,i)=>({block_ref:`block.${b.position}.mean`,title:b.title,analytical_function:systemFunctions[i]}))},
    limitations:q.groups.length?[]:["Нет допущенных групп открытых ответов. Причины числового профиля требуют проверки."],
  };
  const extraction={company_context:a.company_context,groups:q.groups.map(({question,question_position,response_count,texts})=>({question,question_position,response_count,texts}))};
  // At three respondents, an extremum or a narrow score histogram can expose a
  // person's score. B/C dynamics need only group means and population deviation.
  // Preserve the full internal source for unchanged DB checks; minimize AI input.
  const withoutExtremes=<T extends {min:number;max:number;distribution?:number[]}>(value:T)=>{
    const {min,max,distribution,...group}=value;void min;void max;void distribution;return group;
  };
  const dynamics={overall:withoutExtremes(a.overall),blocks:a.blocks.map(withoutExtremes),questions:a.questions.map(withoutExtremes)};
  return {primary,extraction,dynamics,known:new Set(facts.map(f=>f.id))};
}
export type Dossier = ReturnType<typeof buildDossier>;
/** Diagnostics only. Similarity is a review signal, not proof that a recurring theme is wrong. */
export function repetitionSignals(values:{path:string,value:string}[]) {
  const tokens=(s:string)=>new Set(normalizePrivacyText(s).split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>3));
  const signals:{paths:string[];similarity:number}[]=[];
  for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++){
    const a=tokens(values[i].value),b=tokens(values[j].value),n=[...a].filter(x=>b.has(x)).length;
    const similarity=n/Math.max(1,new Set([...a,...b]).size);
    if(a.size>=8&&b.size>=8&&similarity>=0.72)signals.push({paths:[values[i].path,values[j].path],similarity});
  }
  return signals;
}
