import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { teamAIProvider } from "./report-provider";
import { type TeamCallCounts } from "./report-v2-provider";
import { parseQualitativeInputV2, type QualitativeInputV2, type TeamSynthesisV2 } from "./report-v2-contracts";
import { TEAM_REPORT_V3, mainTeamReportInputV3, teamReportV3Schema, teamSynthesisV3Schema, type TeamEvidenceV3 } from "./report-v3-contracts";
import { repairResponseSchema, type RepairField } from "./synthesis-repair";
import { currentControlledTeamAI } from "./controlled-ai-transport";
import {controlledTeamRequired} from '@/server-runtime/team-smoke';
import { logTeamAIStageFailure, type TeamAIStage, type TeamAIPhase } from "./ai-stage-diagnostics";

async function structured<T>(kind:TeamAIPhase,input:unknown,schema:z.ZodType<T>,counts:TeamCallCounts) {
  const requiresControlled=controlledTeamRequired();
  if(requiresControlled&&!currentControlledTeamAI())throw Error('controlled_team_claim_required');
  const config=teamAIProvider(TEAM_REPORT_V3);
  const promptFile=kind==="synthesis"?"TEAM_SYNTHESIS_PROMPT_RU_3.md":kind==="report"?"TEAM_REPORT_PROMPT_RU_3.md":kind==="repair"?"TEAM_SYNTHESIS_REPAIR_PROMPT_RU_2.md":"TEAM_REPORT_REPAIR_PROMPT_RU_2.md";
  // Keep the existing helper-entry counters/retry semantics, not HTTP receipts.
  counts[kind==="synthesis"?"synthesis_call_count":kind==="report"?"report_call_count":"repair_call_count"]++;
  const controlled=currentControlledTeamAI();
  let stage:TeamAIStage="prompt_read";
  try {
    const prompt=readFileSync(join(process.cwd(),promptFile),"utf8");
    stage="serialization";
    const evidence=`<UNTRUSTED_TEAM_EVIDENCE>\n${JSON.stringify(input)}\n</UNTRUSTED_TEAM_EVIDENCE>`;
    stage="schema_conversion";
    const jsonSchema=z.toJSONSchema(schema);
    const body={model:config.model,store:false,max_output_tokens:kind==="report"?14000:6000,
      input:[{role:"system" as const,content:prompt},{role:"user" as const,content:evidence}],
      text:{format:{type:"json_schema" as const,name:`team_${kind}_ru_3`,strict:true as const,schema:jsonSchema}}};
    stage="client_setup";
    const client=controlled?null:new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0,timeout:180000,fetch:(input,init)=>fetch(input,{...init,redirect:"error"})});
    stage="dispatch";
    const response=controlled?await controlled.create(kind==="report"?"main_report":kind==="repair"?"synthesis_repair":kind,body):await client!.responses.create(body);
    stage="response_parse";
    if(response.status!=="completed" || !response.output_text) throw new Error("team_schema_rejected");
    const parsed:unknown=JSON.parse(response.output_text);
    stage="local_validation";
    return schema.parse(parsed);
  } catch(error) {
    // Controlled transport/evidence is unchanged; these are ordinary-flow logs.
    if(!controlled && !requiresControlled) logTeamAIStageFailure(kind,stage,error);
    throw error;
  }
}
export async function synthesizeTeamTextsV3(value:unknown,counts:TeamCallCounts) {
  const input=parseQualitativeInputV2(value);
  return !input.groups.length || teamAIProvider(TEAM_REPORT_V3).provider==="mock"?mockTeamSynthesisV3(input):structured("synthesis",input,teamSynthesisV3Schema,counts);
}
export async function repairV3Fields(fields:RepairField[],counts:TeamCallCounts,report=false) {
  if(teamAIProvider(TEAM_REPORT_V3).provider==="mock") throw new Error("team_privacy_rejected");
  return structured(report?"report_repair":"repair",{fields:fields.map(({path,value})=>({path,value}))},repairResponseSchema(fields.map(f=>f.path)),counts);
}
export async function generateTeamReportV3(aggregates:unknown,summary:unknown,counts:TeamCallCounts) {
  const input=mainTeamReportInputV3(aggregates,summary);
  return teamAIProvider(TEAM_REPORT_V3).provider==="mock"?mockTeamReportV3(input):structured("report",input,teamReportV3Schema,counts);
}
const signals=[
  {match:/согласов|полномоч|владел|ответствен|решени|утвержд/iu,title:"Устройство исполнения",summary:"Из описаний рабочих эпизодов следует потребность сократить движение задачи по инстанциям и сделать устойчивыми границы полномочий.",diagnosis:"Прохождение задач зависит от возврата решений на вышестоящий уровень; это ограничивает самостоятельное исполнение.",action:"Закрепить границы решений для сквозного процесса и критерий передачи готовой работы."},
  {match:/показател|метрик|измер|данн|KPI/iu,title:"Измерение результата",summary:"В качественном материале существенна доступность измерений и их практическое применение при выборе управленческого действия.",diagnosis:"Работа с показателями недостаточно связана с выбором корректирующего действия; приоритеты рискуют оставаться декларациями.",action:"Связать показатель результата с регулярным решением и ответственным за корректировку процесса."},
  {match:/клиент|продукт|приоритет|рынок/iu,title:"Выбор бизнес-приоритетов",summary:"Описанные рабочие задачи дают основание рассмотреть правила выбора продуктовых инициатив и перевод клиентской потребности в исполняемый план.",diagnosis:"Выбор продуктовых инициатив требует общего правила, чтобы ресурсы концентрировались на достижении бизнес-целей.",action:"Задать критерии отбора продуктовых инициатив и проверять их вклад в бизнес-цель на каждом рабочем цикле."},
  {match:/встреч|совещан|ритм|планир|срок/iu,title:"Регулярность управления",summary:"Качественный материал позволяет проверить, как планирование, рабочие встречи и контроль сроков превращают решение в завершённую работу.",diagnosis:"Контроль исполнения требует устойчивого рабочего цикла, связывающего принятые решения с завершением задач.",action:"Установить короткий цикл планирования, проверки исполнения и снятия препятствий."},
];
/** Semantic templates, never arbitrary input strings. All output still passes the corpus gate. */
export function mockTeamSynthesisV3(input:QualitativeInputV2):TeamSynthesisV2 {
  const themes=input.groups.flatMap(g=>{
    const selected=signals.filter(s=>g.texts.some(t=>s.match.test(t)));
    return selected.map(s=>({title:s.title,summary:s.summary,question_position:g.question_position,response_count:g.response_count}));
  }).slice(0,20);
  // Unknown substantive evidence must fail coverage rather than fabricate a theme.
  const chosen=signals.filter(s=>themes.some(t=>t.title===s.title));
  return teamSynthesisV3Schema.parse({themes,strengths:[],problem_patterns:chosen.map(s=>s.diagnosis),growth_constraints:chosen.map(s=>s.diagnosis),risks:chosen.map(s=>`Требует проверки управленческое последствие: ${s.diagnosis}`),opportunities:chosen.map(s=>s.action),management_implications:chosen.map(s=>s.action),alignment_signals:[],divergence_signals:[],contradictions:[],discussion_topics:chosen.map(s=>`Как проверить результат изменения практики «${s.title}»?`)});
}
const number=(n:number)=>n.toLocaleString("ru-RU",{maximumFractionDigits:1});
export function mockTeamReportV3(e:TeamEvidenceV3) {
  const c=e.PRIMARY_CORE_EVIDENCE,d=e.TEAM_DYNAMICS_EVIDENCE;
  const ranked=[...c.blocks].sort((a,b)=>b.mean-a.mean||a.position-b.position),strong=ranked[0],weak=ranked.at(-1)!;
  const s=c.qualitative_summary as Pick<TeamSynthesisV2,"themes"|"strengths"|"problem_patterns"|"growth_constraints"|"risks"|"opportunities"|"management_implications">;
  const chosen=signals.filter(x=>s.themes.some(t=>t.title===x.title));
  const evidence=chosen.length?`Качественные ответы дополняют средний профиль: ${chosen.map(x=>x.diagnosis).join(" ")}`:"Допустимый качественный материал отсутствует; выводы опираются на средний профиль практик.";
  const action=chosen.length?chosen.map(x=>x.action).join(" "):"Уточнить рабочую практику в наиболее слабом блоке и согласовать наблюдаемый результат улучшения.";
  const lowQuestions=c.questions.filter(q=>q.block_position===weak.position).sort((a,b)=>a.mean-b.mean||a.question_position-b.question_position).slice(0,3);
  const problem=`Основное ограничение связано с блоком «${weak.title}»: средняя оценка ${number(weak.mean)}; слабые практики имеют средние ${lowQuestions.map(q=>number(q.mean)).join(", ")} по шкале 0–4.`;
  const plans=(phase:number)=>[
    phase===30?`Выбрать процесс, в котором проявляется ограничение блока «${weak.title}». Описать текущий результат, владельца и связь с бизнес-целью.`:phase===60?`Провести пилот нового правила в процессе, выбранном по слабому блоку «${weak.title}». Проверить завершение задач на реальном рабочем цикле.`:`Оценить эффект пилота блока «${weak.title}» и закрепить правило, которое улучшило предсказуемость исполнения.`,
    !chosen.length?"Уточнить действие по среднему профилю слабой практики; использовать наблюдение за исполнением пилота без ссылок на отсутствующие качественные свидетельства.":phase===30?`По качественным ответам сформировать предмет изменения. ${action}`:phase===60?`По описанным ситуациям проверить применение нового правила. ${action}`:`По качественным наблюдениям уточнить границы применимости практики. ${action}`,
    phase===30?"Зафиксировать исходное время и качество результата процесса; согласовать способ измерения без назначения вымышленных целевых значений.":phase===60?"Сопоставить фактический результат пилота с исходной базой. Устранить причину повторной работы, подтверждённую наблюдением.":"Проверить устойчивость результата на следующем цикле и договориться о дальнейших критериях оценки.",
    phase===30?`Выбрать работающую практику из блока «${strong.title}» и определить, как применить её в пилоте слабой области.`:phase===60?`Применить сильную практику блока «${strong.title}» в пилоте и проверить качество передачи результата.`:`Распространить доказавшую полезность практику блока «${strong.title}» на следующую задачу с назначенным владельцем.`,
    phase===30?"Владелец изменения согласует контрольную точку: описание процесса, правило решения и ожидаемый продукт пилота.":phase===60?"Владелец пилота предъявляет результаты выполнения и перечень устранённых препятствий; руководитель принимает решение о корректировке.":"Руководитель утверждает закреплённые правила, ответственных и следующий цикл улучшений, связанный с бизнес-приоритетами.",
  ];
  const agreement=[...d.blocks].sort((a,b)=>a.stddev_pop-b.stddev_pop||a.position-b.position)[0];
  const divergence=[...d.questions].sort((a,b)=>b.stddev_pop-a.stddev_pop||a.block_position-b.block_position||a.question_position-b.question_position)[0];
  return teamReportV3Schema.parse({participant_count:c.participant_count,
    summary:`Средний индекс управляемости ${number(c.overall_mean)} соответствует уровню «${c.maturity}». Опора системы — блок «${strong.title}», а первоочередной предмет улучшения — «${weak.title}». ${evidence} Для движения к бизнес-целям следует укрепить воспроизводимость исполнения в слабой области и использовать уже работающие практики.`,
    main_diagnosis:`${problem} Системный диагноз — слабая область не обеспечивает столь же устойчивое исполнение, как сильные практики компании. ${evidence} ${action} Управленческая задача состоит в устранении конкретного механизма потерь, а не в повышении оценки ради самой оценки.`,
    manageability_index_text:`Индекс ${number(c.overall_mean)} рассчитан как агрегированный результат завершивших участников. Уровень «${c.maturity}» характеризует среднюю зрелость управленческой системы. Блок «${strong.title}» со средним ${number(strong.mean)} показывает относительную опору; блок «${weak.title}» со средним ${number(weak.mean)} задаёт приоритет укрепления практик, необходимых для бизнес-целей.`,
    strengths:ranked.slice(0,3).map(b=>`Блок «${b.title}» имеет среднее ${number(b.mean)} и выступает относительной опорой профиля. Бизнес-ценность состоит в возможности использовать работающую практику при улучшении слабой области. ${chosen.length?"Качественные описания помогают выбрать рабочую задачу для такого переноса.":"Примените эту опору в процессе, выбранном для улучшения."}`),
    key_problem_zones:ranked.slice(-3).reverse().map(b=>`Среднее блока «${b.title}» — ${number(b.mean)}. Недостаточная устойчивость этой группы практик ограничивает исполнение приоритетов компании. ${evidence} Выберите конкретный переход процесса, закрепите владельца и критерий завершения.`),
    growth_constraint:`${problem} Бизнес-цели требуют, чтобы способность выполнить решение росла вместе с нагрузкой. ${evidence} Главное ограничение роста — воспроизводимость практики в слабой области; её укрепление должно уменьшить ручное вмешательство и повторную работу. ${action}`,
    implementation_risks:[`Если слабый блок «${weak.title}» останется без изменения, рост нагрузки может увеличить потери на исполнении приоритетов. ${evidence}`,"Правило без назначенного владельца может остаться формальностью; закрепите полномочия и критерий готового результата.","Улучшение без исходных измерений затруднит оценку эффекта; сначала согласуйте базу и способ наблюдения.","Перенос сильной практики без учёта процесса может не дать ожидаемой бизнес-ценности; проверьте применимость в пилоте."],
    first_actions:[`${action} ${chosen.length?"Основание — качественные описания рабочих затруднений.":"Основание — средний профиль управленческих практик."}`,`Выбрать слабую практику блока «${weak.title}» по средним вопросам и определить процесс, в котором она нужна для бизнес-цели.`,`Использовать работающий подход блока «${strong.title}» как основу решения, назначив владельца переноса.`,"Зафиксировать исходный результат процесса и ближайшую контрольную точку пилота; руководитель обеспечивает полномочия владельца."],
    plan_30_days:plans(30),plan_60_days:plans(60),plan_90_days:plans(90),
    next_step:`В ближайшие пять рабочих дней руководителю следует организовать разбор процесса слабого блока «${weak.title}». ${evidence} Результатом станет согласованное правило пилота: ${action} Назначьте владельца и способ проверки завершённой работы, связанный с бизнес-целью.`,
    team_analysis:{alignment:[`В блоке «${agreement.title}» стандартное отклонение ${number(agreement.stddev_pop)} при среднем ${number(agreement.mean)}. Близость оценок следует интерпретировать вместе с их уровнем: согласие вокруг слабой практики не является преимуществом.`],
      divergence:[`В вопросе блока «${divergence.block_title}» разброс ${number(divergence.stddev_pop)}, минимум ${number(divergence.min)}, максимум ${number(divergence.max)}. Распределение нормализованных оценок: ${divergence.distribution.join(" / ")}. Обсудите условия применения практики, сохраняя анонимность.`],
      qualitative_signals:[],discussion_questions:["В каких условиях сильная практика даёт устойчивый результат?","Что поможет выполнить новое правило слабого процесса?","Какие различия оценок объясняются условиями работы?","Как проверить гипотезу без поиска авторов ответов?","По какому результату следует принять решение о закреплении пилота?"]}});
}
