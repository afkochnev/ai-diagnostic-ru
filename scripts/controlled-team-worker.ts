import { readFileSync, lstatSync } from "node:fs";
import { serviceConfig } from "../src/server-runtime/supabase/config";
import { runControlledTeamOnce } from "../src/server/team/controlled-runner";
import { createControlledTeamRpc } from "../src/server/team/controlled-rpc";

// The manifest contains approved scope/commit identifiers only. Credentials
// remain inherited protected environment values and are never serialized.
async function main() {
  const path = process.argv[2];
  if (!path) throw Error("controlled_team_manifest_required");
  const file = lstatSync(path);
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    (file.mode & 0o077) ||
    file.size > 8192
  ) throw Error("controlled_team_private_manifest");
  const manifest: unknown = JSON.parse(readFileSync(path, "utf8"));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  try {
    const config = serviceConfig();
    const rpc = createControlledTeamRpc({
      url: config.SUPABASE_URL,
      serviceKey: config.SUPABASE_SERVICE_ROLE_KEY,
      fetch: globalThis.fetch,
      signal: controller.signal,
    });
    const result = await runControlledTeamOnce(manifest, {
      env: process.env,
      apiKey: process.env.OPENAI_API_KEY,
      fetch: globalThis.fetch,
      rpc,
      signal: controller.signal,
    });
    console.info(JSON.stringify(result));
    if (result.status !== "CONTROLLED_TEAM_COMPLETED") process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

void main().catch(() => {
  console.error(JSON.stringify({
    status: "CONTROLLED_TEAM_STOP_HOLD",
    noRetryAuthorized: true,
    detailsOmitted: true,
  }));
  process.exitCode = 1;
});
