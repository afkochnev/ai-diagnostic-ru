import { runProductionWorker } from "../src/server/worker/runner";

const controller=new AbortController();
const state = { stop: false,signal:controller.signal };
const stop = () => { state.stop = true;controller.abort(); };
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

runProductionWorker(state)
  .then(() => { console.info("[worker] stopped"); })
  .catch((error) => { console.error("[worker] fatal", error instanceof Error ? error.message : "unknown"); process.exitCode = 1; });
