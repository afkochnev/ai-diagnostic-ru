import { lstatSync, readFileSync } from "node:fs";
import { runControlledAccessOnce } from "../src/server/team/controlled-access-runner";
import { controlledTeamContext } from "../src/server-runtime/team-smoke";
import { recoverControlledTeamAccess } from "../src/server-runtime/team-w2-access";

// This standalone entry point is inert unless an explicitly armed W2 admits the
// exact participant. Never execute it for local/mock or staging acceptance.
async function main() {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw Error("controlled_team_private_manifest");
  const file = lstatSync(path);
  if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) || file.size > 8192) throw Error("controlled_team_private_manifest");
  const result = await runControlledAccessOnce(JSON.parse(readFileSync(path, "utf8")), {
    env: process.env,
    context: controlledTeamContext,
    recover: recoverControlledTeamAccess,
  });
  console.info(JSON.stringify(result));
}
void main().catch(() => {
  console.error(JSON.stringify({ status: "CONTROLLED_TEAM_ACCESS_STOP_HOLD", noRetryAuthorized: true, detailsOmitted: true }));
  process.exitCode = 1;
});
