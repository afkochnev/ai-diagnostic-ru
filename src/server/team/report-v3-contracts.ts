import { teamReportV2Schema, teamSynthesisV2Schema, mainTeamReportInputV2, parseQualitativeInputV2, teamReportInputV2Schema, type QualitativeInputV2, type TeamSynthesisV2, type TeamReportV2 } from "./report-v2-contracts";
export const TEAM_REPORT_V3 = "TEAM-RU-3";
export const TEAM_SYNTHESIS_V3 = "TEAM-SYNTHESIS-RU-3";
export const OPEN_GROUPS_WITHOUT_USABLE_EVIDENCE = "Допущенные ответы не содержат наблюдений, пригодных для управленческого вывода.";

export function isRuV3TeamQuestionnaire(reportInput: unknown) {
  return teamReportInputV2Schema.parse(reportInput).methodology.version_number === 5;
}

// Derived from the frozen questionnaire. Overall questions have no scored block.
export function openGroupContext(group: QualitativeInputV2["groups"][number]) {
  return {
    question: group.question,
    question_position: group.question_position,
    block_title: group.block_title,
    scope: group.relevant_block ? "block" : group.question_position <= 2 ? "intro" : "final",
  };
}
// Output layout is deliberately compatible; analytical semantics have a new version.
export const teamReportV3Schema = teamReportV2Schema;
export const teamSynthesisV3Schema = teamSynthesisV2Schema;
const managementKeys = ["themes","strengths","problem_patterns","growth_constraints","risks","opportunities","management_implications"] as const;
export function qualitativeCoverage(
  value: unknown, summary: unknown, emit: (coverage: Record<string, number>) => void = () => {},
  parsedRuV3?: QualitativeInputV2,
) {
  const input = parsedRuV3 ?? parseQualitativeInputV2(value);
  const synthesis = teamSynthesisV3Schema.parse(summary);
  if (parsedRuV3) {
    const counts = new Map(input.groups.map(group => [group.question_position, group.response_count]));
    if (synthesis.themes.some(theme => counts.get(theme.question_position) !== theme.response_count)) {
      throw new Error("team_numeric_integrity");
    }
  }
  const substantive=(s:string)=>s.trim().length>=40 && !/недостаточно.{0,30}свидетельств|нет допустимых|есть некоторые проблемы|следует улучшить коммуникац/iu.test(s);
  const non_empty_synthesis_sections=managementKeys.filter(k=>synthesis[k].some(x=>substantive(typeof x==="string"?x:x.summary))).length;
  const positions=new Set(input.groups.map(g=>g.question_position));
  const usable_qualitative_groups=new Set(synthesis.themes.filter(t=>positions.has(t.question_position)&&substantive(t.summary)).map(t=>t.question_position)).size;
  const coverage={eligible_open_questions:input.groups.length,groups_sent_to_synthesis:input.groups.length,non_empty_synthesis_sections,usable_qualitative_groups};
  emit(coverage);
  const explicitLimit = parsedRuV3 && !synthesis.themes.length
    && synthesis.management_implications.length === 1
    && synthesis.management_implications[0] === OPEN_GROUPS_WITHOUT_USABLE_EVIDENCE
    && managementKeys.every(key => key === "management_implications" || !synthesis[key].length);
  if (coverage.eligible_open_questions > 0 && !explicitLimit && (!usable_qualitative_groups || non_empty_synthesis_sections < 2)) {
    throw new Error("team_qualitative_insufficient");
  }
  return coverage;
}
export function mainTeamReportInputV3(aggregates: unknown, summary: unknown, qualitative?: QualitativeInputV2) {
  const input=mainTeamReportInputV2(aggregates,summary);
  const s=input.qualitative_summary;
  return {
    PRIMARY_CORE_EVIDENCE:{
      participant_count:input.participant_count,company_context:input.company_context,methodology:input.methodology,
      overall_mean:input.overall.mean,maturity:input.overall.maturity,
      blocks:input.blocks.map(({title,position,mean})=>({title,position,mean})),
      questions:input.questions.map(({question,block_title,block_position,question_position,mean,normalized_direction})=>({question,block_title,block_position,question_position,mean,normalized_direction})),
      qualitative_summary:Object.fromEntries(managementKeys.map(k=>[k,s[k]])),
      ...(qualitative ? {
        open_question_context: qualitative.groups.map(openGroupContext),
        equal_block_means: input.blocks.every(block => block.mean === input.blocks[0].mean),
      } : {}),
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
export type CoreQualityIssue = {
  field_path: string;
  reason: "core_dynamics" | "test_wording" | "duplicate_paragraph";
};
/** Field paths and rule names only: generated report text stays inside validation. */
export function inspectCoreQuality(report: TeamReportV2, provider: "mock" | "openai"): CoreQualityIssue[] {
  const issues: CoreQualityIssue[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(report)) {
    if (key === "participant_count" || key === "team_analysis") continue;
    const paragraphs = typeof value === "string" ? [{field_path: key, text: value}]
      : Array.isArray(value) ? value.map((text, index) => ({field_path: `${key}[${index}]`, text})) : [];
    for (const {field_path, text} of paragraphs) {
      if (/stddev|variance|distribution|дисперси|разброс|поляризац|расхождени|разных? картин|противоположн.{0,20}оцен|среднее скрывает|по-разному оценива/iu.test(text)) {
        issues.push({field_path, reason: "core_dynamics"});
      }
      if (provider === "openai" && /тестовый отчёт|тестовая гипотеза|тестовое ограничение/iu.test(text)) {
        issues.push({field_path, reason: "test_wording"});
      }
      if (seen.has(text)) issues.push({field_path, reason: "duplicate_paragraph"});
      seen.add(text);
    }
  }
  return issues;
}
export function validateCoreQuality(report: TeamReportV2, provider: "mock"|"openai", synthesis: TeamSynthesisV2) {
  // Coverage is checked before generation. Prescribed source words cannot
  // establish whether the report actually uses the anonymous evidence.
  void synthesis;
  if (inspectCoreQuality(report, provider).length) throw new Error("team_quality_rejected");
}
