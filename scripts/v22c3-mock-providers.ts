import { readFileSync } from "node:fs";
import { mockTeamSynthesisV3, generateTeamReportV3 } from "../src/server/team/report-v3-provider";
import { parseQualitativeInputV2 } from "../src/server/team/report-v2-contracts";
import { qualitativeCoverage, validateCoreQuality } from "../src/server/team/report-v3-contracts";
import { privacyCorpusSchema } from "../src/server/team/synthesis-privacy";
import { validateAndRepairSynthesis } from "../src/server/team/synthesis-repair";
import { validateAndRepairReport } from "../src/server/team/report-privacy";
async function main() {
const prepared=JSON.parse(readFileSync(0,"utf8"));
if(process.env.TEAM_AI_PROVIDER!=="mock")throw new Error("mock_only");
const corpus=privacyCorpusSchema.parse(prepared.privacy_corpus),input=parseQualitativeInputV2(prepared.qualitative_input);
const deny=async()=>{throw new Error("mock_privacy_failure");};
const synthesis=await validateAndRepairSynthesis(mockTeamSynthesisV3(input),input,corpus,deny);
const coverage=qualitativeCoverage(input,synthesis);
const generated=await generateTeamReportV3(prepared.report_input,synthesis,{synthesis_call_count:0,repair_call_count:0,report_call_count:0});
const report=await validateAndRepairReport(generated,prepared.report_input,corpus,"mock",deny);
validateCoreQuality(report,"mock",synthesis);
process.stdout.write(JSON.stringify({synthesis,report,coverage}));

}
void main().catch((error:unknown)=>{console.error(error instanceof Error && /^team_[a-z_]+$/.test(error.message)?error.message:"mock_fixture_failed");process.exitCode=1;});
