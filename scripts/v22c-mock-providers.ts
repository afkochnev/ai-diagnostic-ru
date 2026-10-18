/** Local synthetic fixture helper. Explicit mock provider; never talks to a remote database/model. */
import { synthesizeTeamTextsV2, generateTeamReportV2 } from "../src/server/team/report-v2-provider";
if (process.env.TEAM_AI_PROVIDER !== "mock") throw new Error("mock_fixture_only");
async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const prepared = JSON.parse(raw);
  const synthesis = await synthesizeTeamTextsV2(prepared.qualitative_input);
  const report = await generateTeamReportV2(prepared.report_input, synthesis);
  process.stdout.write(JSON.stringify({ synthesis, report }));
}
void main().catch(() => { console.error("mock_fixture_failed"); process.exitCode = 1; });
