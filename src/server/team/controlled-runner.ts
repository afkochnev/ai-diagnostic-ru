import { performance } from "node:perf_hooks";
import { controlledTeamRequired } from "@/server-runtime/team-smoke";
import {
  ControlledTeamAITransport,
  controlledTeamModel,
  validateControlledClaim,
  withControlledTeamAI,
  withControlledTeamClaim,
  type ControlledTeamClaim,
  type ControlledTeamRpc,
} from "./controlled-ai-transport";
import { processTeamJob } from "./worker";
import { controlledManifestWindow, parseControlledTeamManifest } from "./controlled-manifest";
export type { ControlledTeamManifest } from "./controlled-manifest";

const allowed = new Set([
  "process_team_aggregate",
  "prepare_team_report_job",
  "get_team_synthesis_privacy_corpus",
  "store_team_synthesis",
  "publish_team_report",
  "fail_team_job",
]);
type Ports = {
  rpc: ControlledTeamRpc;
  fetch: typeof fetch;
  apiKey?: string;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
  monotonic?: () => number;
};

/** One exact claim, no polling or fallback to the ordinary global worker. */
export async function runControlledTeamOnce(value: unknown, ports: Ports) {
  const manifest = parseControlledTeamManifest(value);
  const windowId = controlledManifestWindow(manifest);
  const clock = ports.monotonic ?? (() => performance.now());
  const requiredOff = [
    "ACQUISITION_ENABLED",
    "ACQUISITION_START_ENABLED",
    "BILLING_ENABLED",
    "YOOKASSA_REFUNDS_ENABLED",
    "YOOKASSA_RECONCILIATION_ENABLED",
    ...(windowId ? ["TEAM_CREATION_ENABLED", "TEAM_INVITATIONS_ENABLED"] : []),
  ];
  const invalidAIConfig = manifest.kind === "team_ai_report" && (
    !manifest.reportId ||
    !ports.apiKey?.trim() ||
    ports.env.TEAM_AI_PROVIDER !== "openai" ||
    (ports.env.TEAM_AI_MODEL ?? ports.env.OPENAI_MODEL) !== controlledTeamModel
  );
  if (
    !controlledTeamRequired(ports.env) ||
    ports.env.RENDER_GIT_COMMIT !== manifest.expectedSHA ||
    ports.env.TEAM_ENABLED !== "true" ||
    requiredOff.some(key => ports.env[key] !== "false") ||
    ports.env.YOOKASSA_SECRET_KEY ||
    invalidAIConfig ||
    (manifest.kind === "team_aggregate" && manifest.reportId !== null)
  ) throw Error("controlled_team_runtime_binding");

  let claim: ControlledTeamClaim | undefined;
  let transport: ControlledTeamAITransport | undefined;
  let failedPersisted = false;
  let failureAttempted = false;
  const beforeClaim = clock();
  try {
    if (ports.signal?.aborted) throw Error("controlled_team_stopped");
    const result = await ports.rpc(windowId ? "claim_controlled_team_window_job" : "claim_controlled_team_job", {
      p_run_id: manifest.runId,
      ...(windowId ? { p_window_id: windowId } : {}),
      p_kind: manifest.kind,
      p_source_fingerprint: manifest.sourceFingerprint,
      p_report_id: manifest.reportId,
    });
    if (result.error) throw Error("controlled_team_claim_required");
    const candidate = validateControlledClaim(result.data);
    if (
      candidate.run_id !== manifest.runId ||
      candidate.team_id !== manifest.teamId ||
      candidate.source_fingerprint !== manifest.sourceFingerprint ||
      candidate.report_id !== manifest.reportId ||
      candidate.kind !== manifest.kind
      || (candidate.window_id ?? null) !== windowId
      || ("version" in manifest && candidate.approved_plan_hash !== manifest.planSHA256)
    ) throw Error("controlled_team_claim_required");

    // Only a fully matched claim may be failed by this runner on a later error.
    claim = candidate;
    const owned = claim;
    const serverNow = Date.parse(owned.server_now);
    const leaseExpires = Date.parse(owned.lease_expires_at);
    const generationExpires = owned.deadline_at === null
      ? leaseExpires - 60000
      : Date.parse(owned.deadline_at);
    if (!Number.isFinite(generationExpires)) throw Error("controlled_team_deadline_required");
    // Start from the monotonic timestamp before claim dispatch, subtracting the
    // entire claim round trip. Nothing later can reset or extend this boundary.
    const workDeadline = beforeClaim + Math.min(
      generationExpires - serverNow,
      leaseExpires - serverNow - 60000,
      540000,
    ) - 2000;
    const rpc: ControlledTeamRpc = async (name, args) => {
      if (
        !allowed.has(name) ||
        args.p_job_id !== owned.job_id ||
        args.p_lease_token !== owned.lease_token
      ) throw Error("controlled_team_rpc_scope");
      if (name !== "fail_team_job") {
        if (ports.signal?.aborted || workDeadline - clock() <= 30000) {
          throw Error("controlled_team_work_deadline");
        }
        transport?.assertWorkWindow();
      }
      if (name === "fail_team_job") failureAttempted = true;
      const response = await ports.rpc(name, args);
      if (name === "fail_team_job" && !response.error) failedPersisted = true;
      return response;
    };
    if (manifest.kind === "team_ai_report") {
      transport = new ControlledTeamAITransport({
        claim,
        rpc: ports.rpc,
        fetch: ports.fetch,
        apiKey: ports.apiKey!,
        signal: ports.signal,
        monotonic: clock,
        claimRoundTripMs: clock() - beforeClaim,
      });
      await transport.preflightModel();
    }
    if (ports.signal?.aborted) throw Error("controlled_team_stopped");
    const job = {
      id: claim.job_id,
      kind: claim.kind,
      lease_token: claim.lease_token,
      attempts: claim.attempts,
      pipeline_version: claim.pipeline_version,
      controlled_run_id: claim.run_id,
      controlled_window_id: claim.window_id ?? null,
    };
    const process = () => withControlledTeamClaim(owned, () => processTeamJob(job, rpc));
    const outcome = transport
      ? await withControlledTeamAI(transport, process)
      : await process();
    if (outcome !== "completed") throw Error("controlled_team_job_failed");
    return {
      status: "CONTROLLED_TEAM_COMPLETED" as const,
      kind: manifest.kind,
      runId: manifest.runId,
      continuationWindowId: windowId,
      teamId: manifest.teamId,
      reportId: manifest.reportId,
      sourceFingerprint: manifest.sourceFingerprint,
      audit: transport?.safeAudit() ?? null,
    };
  } catch {
    let safelyContained = failedPersisted;
    // Never requeue, clear a lease, reset a reservation, or claim another job.
    // A failed/lost-lease RPC leaves containment unproved and requires a hold.
    if (claim && !failedPersisted && !failureAttempted) {
      try {
        const result = await ports.rpc("fail_team_job", {
          p_job_id: claim.job_id,
          p_lease_token: claim.lease_token,
          p_error_code: "team_processing_failed",
          p_retryable: false,
        });
        safelyContained = !result.error;
      } catch {
        safelyContained = false;
      }
    }
    let runStopped = false;
    try {
      const result = await ports.rpc(windowId ? "stop_controlled_team_window" : "stop_controlled_team_run", {
        p_run_id: manifest.runId,
        ...(windowId ? { p_window_id: windowId } : {}),
        p_reason: "controlled_worker_stopped",
      });
      runStopped = !result.error &&
        (result.data as { status?: string } | null)?.status === "stopped";
    } catch {
      // An unconfirmed stop remains a hold; it never authorizes another call.
    }
    return {
      status: safelyContained && runStopped
        ? "CONTROLLED_TEAM_STOP_CONTAINED" as const
        : "CONTROLLED_TEAM_STOP_HOLD" as const,
      kind: manifest.kind,
      runId: manifest.runId,
      continuationWindowId: windowId,
      teamId: manifest.teamId,
      reportId: manifest.reportId,
      audit: transport?.safeAudit() ?? null,
      runStopped,
      ownedFailurePersisted: safelyContained,
      noRetryAuthorized: true,
    };
  }
}

export { controlledTeamModel };
