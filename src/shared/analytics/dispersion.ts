/** Product interpretation only. Never used by scoring or maturity calculation. */
export const DISPERSION_INTERPRETATION_VERSION="v1";
export type DispersionKey="low"|"moderate"|"high"|"very_high";
export const dispersionDescriptions:Record<DispersionKey,{label:string;description:string}>={
 low:{label:"Низкий",description:"Оценки участников близки. Это означает сходное восприятие ситуации, но не означает автоматически высокий уровень практики."},
 moderate:{label:"Умеренный",description:"Есть заметные различия оценок, но общая картина остаётся относительно близкой."},
 high:{label:"Высокий",description:"Оценки существенно различаются. Среднее требует осторожной интерпретации, а тему полезно дополнительно проверить."},
 very_high:{label:"Очень высокий",description:"Оценки резко различаются. Среднее может скрывать существенно разные представления ситуации; вопрос требует отдельного управленческого обсуждения."},
};
export const dispersionDisclaimer="Уровни разброса являются интерпретационной шкалой отчёта и помогают сравнивать оценки внутри диагностики. Они не являются статистическим доказательством конфликта.";
export const smallGroupDispersionNote="При небольшом числе участников уровень разброса следует использовать как ориентир для обсуждения, а не как статистическую оценку всей компании.";
export function classifyDispersion(stddev:number,scaleRange:number){
 if(!Number.isFinite(stddev)||stddev<0||!Number.isFinite(scaleRange)||scaleRange<=0)throw new RangeError("invalid_dispersion");
 const normalizedPercent=stddev/scaleRange*100;
 if(!Number.isFinite(normalizedPercent))throw new RangeError("invalid_dispersion");
 const key:DispersionKey=normalizedPercent<=10?"low":normalizedPercent<=20?"moderate":normalizedPercent<=30?"high":"very_high";
 return {key,label:dispersionDescriptions[key].label,normalizedPercent};
}
export const displayAnalyticalNumber=(value:number|string)=>Number(value).toLocaleString("ru-RU",{maximumFractionDigits:1});

export type DispersionQuestion={number?:number;position:number;blockPosition:number;blockTitle:string;question:string;mean:number;stddev:number;participantCount:number};
export type DispersionProfile={overall:{mean:number;stddev:number;maturity:string};blocks:{position:number;title:string;mean:number;stddev:number}[];questions:DispersionQuestion[];participantCount:number};
export function orderedDispersionQuestions(questions:DispersionQuestion[],descending=false){
 return [...questions].sort((a,b)=>(descending?-1:1)*(a.stddev-b.stddev)||a.blockPosition-b.blockPosition||a.position-b.position);
}
