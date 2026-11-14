import { readFileSync } from "node:fs";
import { generateTeamReportV3, mockTeamSynthesisV3 } from "../src/server/team/report-v3-provider";
import { parseQualitativeInputForRuV3, parseQualitativeInputV2 } from "../src/server/team/report-v2-contracts";
import { isRuV3TeamQuestionnaire, qualitativeCoverage, validateCoreQuality } from "../src/server/team/report-v3-contracts";
import { privacyCorpusSchema } from "../src/server/team/synthesis-privacy";
import { validateAndRepairSynthesis } from "../src/server/team/synthesis-repair";
import { validateAndRepairReport } from "../src/server/team/report-privacy";

async function main() {
  if (process.env.TEAM_AI_PROVIDER !== "mock") throw new Error("mock_only");
  const prepared = JSON.parse(readFileSync(0, "utf8"));
  const ruV3 = isRuV3TeamQuestionnaire(prepared.report_input);
  const corpus = privacyCorpusSchema.parse(prepared.privacy_corpus);
  const input = ruV3 ? parseQualitativeInputForRuV3(prepared.qualitative_input) : parseQualitativeInputV2(prepared.qualitative_input);
  const deny = async () => { throw new Error("mock_privacy_failure"); };
  const synthesis = await validateAndRepairSynthesis(mockTeamSynthesisV3(input, ruV3), input, corpus, deny);
  const coverage = qualitativeCoverage(input, synthesis, undefined, ruV3 ? input : undefined);
  const counts = { synthesis_call_count: 0, repair_call_count: 0, report_call_count: 0 };
  const generated = await generateTeamReportV3(prepared.report_input, synthesis, counts, ruV3 ? input : undefined);
  const report = await validateAndRepairReport(generated, prepared.report_input, corpus, "mock", deny);
  validateCoreQuality(report, "mock", synthesis);
  process.stdout.write(JSON.stringify({ synthesis, report, coverage }));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error && /^team_[a-z_]+$/.test(error.message) ? error.message : "mock_fixture_failed");
  process.exitCode = 1;
});
