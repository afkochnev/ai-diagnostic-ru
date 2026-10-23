import type { ControlledTeamRpc } from "./controlled-ai-transport";

const origin = "https://fhvxqeaujjeiflanqsbg.supabase.co";
const allowed = new Set([
  "claim_controlled_team_job",
  "reserve_controlled_team_ai_call",
  "complete_controlled_team_effect",
  "stop_controlled_team_run",
  "process_team_aggregate",
  "prepare_team_report_job",
  "get_team_synthesis_privacy_corpus",
  "store_team_synthesis",
  "publish_team_report",
  "fail_team_job",
]);
const cleanup = new Set([
  "complete_controlled_team_effect",
  "fail_team_job",
  "stop_controlled_team_run",
]);

/** Node-only exact RPC transport: no SDK polling/retry, no REST table writes. */
export function createControlledTeamRpc(options: {
  url: string;
  serviceKey: string;
  fetch: typeof fetch;
  signal?: AbortSignal;
}): ControlledTeamRpc {
  if (
    options.url !== origin ||
    !options.serviceKey.trim() ||
    typeof options.fetch !== "function"
  ) throw Error("controlled_team_rpc_config");

  return async (name, args) => {
    if (!allowed.has(name)) throw Error("controlled_team_rpc_scope");
    const timeout = AbortSignal.timeout(30000);
    // After shutdown, no new work is admitted. Bounded cleanup remains possible
    // so an uncertain provider result can be recorded without opening a retry.
    const signal = options.signal && !cleanup.has(name)
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    try {
      if (signal.aborted) throw Error("aborted");
      const response = await options.fetch(`${origin}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.serviceKey}`,
          apikey: options.serviceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        return { data: null, error: { message: "controlled_team_rpc_failed" } };
      }
      // This exact RPC returns SQL void. PostgREST can represent success with
      // an empty body, which must not be mistaken for an unknown failure.
      if (name === "fail_team_job") {
        const body = await response.text();
        return { data: body ? JSON.parse(body) : null, error: null };
      }
      return { data: await response.json(), error: null };
    } catch {
      return { data: null, error: { message: "controlled_team_rpc_unknown" } };
    }
  };
}
