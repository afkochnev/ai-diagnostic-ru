import { teamReportV2Schema, teamSynthesisV2Schema, mainTeamReportInputV2, parseQualitativeInputV2, type TeamSynthesisV2, type TeamReportV2 } from "./report-v2-contracts";
export const TEAM_REPORT_V3 = "TEAM-RU-3";
export const TEAM_SYNTHESIS_V3 = "TEAM-SYNTHESIS-RU-3";
// Output layout is deliberately compatible; analytical semantics have a new version.
export const teamReportV3Schema = teamReportV2Schema;
export const teamSynthesisV3Schema = teamSynthesisV2Schema;
const managementKeys = ["themes","strengths","problem_patterns","growth_constraints","risks","opportunities","management_implications"] as const;
export function qualitativeCoverage(value: unknown, summary: unknown, emit:(coverage:Record<string,number>)=>void=()=>{}) {
  const input=parseQualitativeInputV2(value), synthesis=teamSynthesisV3Schema.parse(summary);
  const substantive=(s:string)=>s.trim().length>=40 && !/недостаточно.{0,30}свидетельств|нет допустимых|есть некоторые проблемы|следует улучшить коммуникац/iu.test(s);
  const non_empty_synthesis_sections=managementKeys.filter(k=>synthesis[k].some(x=>substantive(typeof x==="string"?x:x.summary))).length;
  const positions=new Set(input.groups.map(g=>g.question_position));
  const usable_qualitative_groups=new Set(synthesis.themes.filter(t=>positions.has(t.question_position)&&substantive(t.summary)).map(t=>t.question_position)).size;
  const coverage={eligible_open_questions:input.groups.length,groups_sent_to_synthesis:input.groups.length,non_empty_synthesis_sections,usable_qualitative_groups};
  emit(coverage);
  if(coverage.eligible_open_questions>0 && (!usable_qualitative_groups || non_empty_synthesis_sections<2)) throw new Error("team_qualitative_insufficient");
  return coverage;
}
export function mainTeamReportInputV3(aggregates: unknown, summary: unknown) {
  const input=mainTeamReportInputV2(aggregates,summary);
  const s=input.qualitative_summary;
  return {
    PRIMARY_CORE_EVIDENCE:{
      participant_count:input.participant_count,company_context:input.company_context,methodology:input.methodology,
      overall_mean:input.overall.mean,maturity:input.overall.maturity,
      blocks:input.blocks.map(({title,position,mean})=>({title,position,mean})),
      questions:input.questions.map(({question,block_title,block_position,question_position,mean,normalized_direction})=>({question,block_title,block_position,question_position,mean,normalized_direction})),
      qualitative_summary:Object.fromEntries(managementKeys.map(k=>[k,s[k]])),
    },
    TEAM_DYNAMICS_EVIDENCE:{overall:input.overall,blocks:input.blocks,questions:input.questions,
      qualitative_summary:{alignment_signals:s.alignment_signals,divergence_signals:s.divergence_signals,contradictions:s.contradictions,discussion_topics:s.discussion_topics}},
  };
}
export type TeamEvidenceV3 = ReturnType<typeof mainTeamReportInputV3>;
export function coreText(report: TeamReportV2) {
  const {team_analysis,participant_count,...core}=report;void team_analysis;void participant_count;
  return Object.values(core).flat().join("\n");
}
export function validateCoreQuality(report: TeamReportV2, provider: "mock"|"openai", synthesis: TeamSynthesisV2) {
  const text=coreText(report);
  if(/stddev|variance|distribution|дисперси|разброс|поляризац|расхождени|разных? картин|противоположн.{0,20}оцен|среднее скрывает|по-разному оценива/iu.test(text)) throw new Error("team_quality_rejected");
  if(provider==="openai" && /тестовый отчёт|тестовая гипотеза|тестовое ограничение/iu.test(text)) throw new Error("team_quality_rejected");
  if(managementKeys.some(k=>synthesis[k].length) && !/качествен|открыт.{0,12}ответ|описан.{0,12}ситуац/iu.test(text)) throw new Error("team_qualitative_insufficient");
  const paragraphs=Object.values(report).flat().filter((x):x is string=>typeof x==="string");
  if(new Set(paragraphs).size!==paragraphs.length) throw new Error("team_quality_rejected");
}
