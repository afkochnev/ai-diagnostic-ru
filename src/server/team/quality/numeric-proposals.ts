import type { Program } from "./contracts";

// Only operational sample sizes and proposed durations, never scores, money,
// percentages, targets or respondent counts. A value remains local to its action.
const quantity=/\b(\d+(?:[.,]\d+)?(?:\s*[–—-]\s*\d+(?:[.,]\d+)?)?)\s+(?:(?:последовательн\p{L}*|ближайш\p{L}*|производственн\p{L}*|рабоч\p{L}*|календарн\p{L}*)\s+){0,3}(заказ(?:ов|а|ы|ам|ах|ами|у|е)?|проект(?:ов|а|ы|ам|ах|ами|у|е)?|случа(?:ев|я|и|ям|ях|ями|ю|е)|недел(?:ь|и|ю|ям|ях|ями)|месяц(?:ев|а|ы|ам|ах|ами)?|дн(?:ей|я|и|ям|ях|ями)|день)(?=$|[^\p{L}])/giu;
const numbers=(s:string)=>[...s.matchAll(/\d+(?:[.,]\d+)?/gu)].map(m=>Number(m[0].replace(",",".")));
function unit(s:string){return /заказ/iu.test(s)?"orders":/проект/iu.test(s)?"projects":/случа/iu.test(s)?"cases":/недел/iu.test(s)?"weeks":/месяц/iu.test(s)?"months":"days";}
function quantities(s:string){return [...s.matchAll(new RegExp(quantity.source,quantity.flags))].map(m=>({start:m.index,end:m.index+m[0].length,key:JSON.stringify([numbers(m[1]),unit(m[2])])}));}
const phaseByField:Record<string,string>={first_actions:"immediate",plan_30_days:"30",plan_60_days:"60",plan_90_days:"90"};
/** Return only witnessed numeric spans, not a paragraph-wide number whitelist.
 * Explicit proposal wording is mandatory in the same clause; actual measurements
 * and parameters of another phase/action remain subject to frozen-fact checking. */
export function proposalNumberOffsets(text:string,path:string,refs:string[],program?:Program) {
  const phase=phaseByField[path.split("[")[0]];
  if(!phase||!program)return new Set<number>();
  const allowed=new Set(program.initiatives.flatMap(i=>i.actions).filter(a=>a.phase===phase&&refs.includes(a.id)).flatMap(a=>quantities([a.action,a.deliverable,a.verification].join("\n")).map(q=>q.key)));
  const offsets=new Set<number>();let start=0;
  for(const clause of text.split(/(?<=[.!?;])\s+|\n+/u)){
    const at=text.indexOf(clause,start);start=at+clause.length;
    if(!/(?:^|[^\p{L}])(?:предлагается|рекомендуется|предлагаем|рекомендуем)(?=$|[^\p{L}])/iu.test(clause))continue;
    for(const q of quantities(clause))if(allowed.has(q.key))for(const match of clause.slice(q.start,q.end).matchAll(/\d+(?:[.,]\d+)?/gu))offsets.add(at+q.start+match.index);
  }
  return offsets;
}
