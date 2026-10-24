import { z } from "zod";
import { controlledTeamRequired, type ControlledTeamContext } from "@/server-runtime/team-smoke";

const schema = z.strictObject({
  version: z.literal(2),
  operation: z.literal("participant_access_recovery"),
  runId: z.uuid(),
  continuationWindowId: z.uuid(),
  teamId: z.uuid(),
  participantId: z.uuid(),
  expectedSHA: z.string().regex(/^[a-f0-9]{40}$/),
  planSHA256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ControlledAccessManifest = z.infer<typeof schema>;
export function parseControlledAccessManifest(value: unknown) { return schema.parse(value); }

type Ports = {
  env: Record<string, string | undefined>;
  context: (target: { windowId: string; participantId: string }) => Promise<ControlledTeamContext | null>;
  recover: (target: { windowId: string; participantId: string }) => Promise<{ windowId: string; participantId: string; status: "succeeded" }>;
};

/** Exactly one existing participant. No cohort loop, probing credential, resend
 * or fallback. DB reservations remain the effect admission boundary. */
export async function runControlledAccessOnce(value: unknown, ports: Ports) {
  const manifest = parseControlledAccessManifest(value);
  const closed = ["ACQUISITION_ENABLED", "ACQUISITION_START_ENABLED", "TEAM_CREATION_ENABLED", "TEAM_INVITATIONS_ENABLED", "BILLING_ENABLED", "YOOKASSA_REFUNDS_ENABLED", "YOOKASSA_RECONCILIATION_ENABLED"];
  if (!controlledTeamRequired(ports.env) || ports.env.RENDER_GIT_COMMIT !== manifest.expectedSHA || ports.env.TEAM_ENABLED !== "true" || ports.env.TEAM_INVITATION_EMAIL_PROVIDER !== "resend" || closed.some(key => ports.env[key] !== "false") || ports.env.YOOKASSA_SECRET_KEY) {
    throw Error("controlled_team_access_runtime_binding");
  }
  const target = { windowId: manifest.continuationWindowId, participantId: manifest.participantId };
  const context = await ports.context(target);
  if (!context || context.run_id !== manifest.runId || context.window_id !== target.windowId || context.team_id !== manifest.teamId || context.participant_id !== target.participantId || context.approved_plan_hash !== manifest.planSHA256) {
    throw Error("controlled_team_access_manifest_binding");
  }
  const result = await ports.recover(target);
  if (result.status !== "succeeded" || result.windowId !== target.windowId || result.participantId !== target.participantId) throw Error("controlled_team_access_receipt_required");
  return { status: "CONTROLLED_TEAM_ACCESS_COMPLETED" as const, runId: manifest.runId, continuationWindowId: target.windowId, participantId: target.participantId, noRetryAuthorized: true };
}
