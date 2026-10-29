import type { TeamReportContent } from "./report-contracts";
import type { TeamReportV2 } from "./report-v2-contracts";
export type TeamStatistic = { block_id?: string; question_id?: string; title?: string; prompt?: string; position: number; block_position?: number; participant_count: number; mean_score: number; stddev_score: number; min_score: number; max_score: number; distribution?: number[]; reverse_score?: boolean };
export type TeamResults = {
  status: "threshold" | "pending" | "ready"; completed_count: number; fingerprint?: string; maturity?: string;
  overall?: { overall_mean: number; overall_stddev: number; overall_min: number; overall_max: number };
  blocks?: TeamStatistic[]; questions?: TeamStatistic[]; aggregate_error?: string | null;
  reports?: Array<{ id: string; version: number; source_fingerprint: string; completed_participant_count: number; status: string; prompt_version?: string; model?: string | null; provider_mode?: string | null; structured_content: TeamReportContent | TeamReportV2 | null; created_at: string; error_code: string | null }>;
};
export function orderDispersion(rows: TeamStatistic[], descending = false) {
  return [...rows].sort((a,b)=>(descending ? -1 : 1)*(Number(a.stddev_score)-Number(b.stddev_score))
    || (a.block_position ?? 0)-(b.block_position ?? 0) || a.position-b.position
    || (a.block_id ?? a.question_id ?? "").localeCompare(b.block_id ?? b.question_id ?? ""));
}

type TeamReport = NonNullable<TeamResults["reports"]>[number];
export function isMockTeamReport(report:TeamReport) {
 return report.provider_mode==="mock" || Boolean(report.model?.startsWith("team-mock-"));
}
function currentTeamReports(reports:TeamReport[],fingerprint:string|undefined,pipeline:string) {
 return reports.filter(r=>r.source_fingerprint===fingerprint && r.prompt_version===pipeline).sort((a,b)=>b.version-a.version);
}
/** Lifecycle state belongs to the newest real attempt, even while an older result stays readable. */
export function latestTeamReportAttempt(reports:TeamReport[],fingerprint:string|undefined,pipeline:string) {
 const candidates=currentTeamReports(reports,fingerprint,pipeline);
 return candidates.find(r=>!isMockTeamReport(r)) ?? candidates[0];
}
/** Prefer a real completed result within the exact source/pipeline, regardless of mock version order. */
export function preferredCompletedTeamReport(reports:TeamReport[],fingerprint:string|undefined,pipeline:string) {
 const completed=currentTeamReports(reports,fingerprint,pipeline).filter(r=>r.status==="completed");
 return completed.find(r=>!isMockTeamReport(r)) ?? completed[0];
}
export function preferredTeamReport(reports:TeamReport[],fingerprint:string|undefined,pipeline:string) {
 return preferredCompletedTeamReport(reports,fingerprint,pipeline) ?? latestTeamReportAttempt(reports,fingerprint,pipeline);
}
