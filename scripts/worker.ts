import { runProductionWorker } from "../src/server/worker/runner";

const state = { stop: false };
const stop = () => { state.stop = true; };
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

runProductionWorker(state)
  .then(() => { console.info("[worker] stopped"); })
  .catch((error) => { console.error("[worker] fatal", error instanceof Error ? error.message : "unknown"); process.exitCode = 1; });
