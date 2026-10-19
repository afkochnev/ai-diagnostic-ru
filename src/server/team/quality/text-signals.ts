import { stringLeaves } from "../synthesis-privacy";

export type EditorialSignal={path:string;code:"dynamics_lexeme"|"service_phrase"};
/** A word match is an editorial lead, not a semantic quality verdict. No text retained. */
export function primaryEditorialSignals(value:unknown):EditorialSignal[]{
  const matches:EditorialSignal[]=[];
  for(const leaf of stringLeaves(value)){
    if(/stddev|variance|distribution|разброс|поляризац|расхождени|дисперси|среднее скрывает/iu.test(leaf.value))matches.push({path:leaf.path,code:"dynamics_lexeme"});
    if(/качественные ответы дополняют средний профиль|тестовый отчёт|архитектура исполнения/iu.test(leaf.value))matches.push({path:leaf.path,code:"service_phrase"});
  }
  return matches;
}
export class QualityTextError extends Error {
  constructor(readonly signal:EditorialSignal){super("team_quality_rejected");}
  safeDetails(){return {reason:"editorial_lexeme_match",field_path:this.signal.path,code:this.signal.code};}
}
