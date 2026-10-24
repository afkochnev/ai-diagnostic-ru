import { z } from "zod";

const fields = {
  runId: z.uuid(),
  teamId: z.uuid(),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(["team_aggregate", "team_ai_report"]),
  reportId: z.uuid().nullable(),
  expectedSHA: z.string().regex(/^[a-f0-9]{40}$/),
};

// The original six-key manifest remains v1. Adding a window to a v1 manifest
// must fail instead of silently selecting a new allowance.
const legacy = z.strictObject(fields);
const window = z.strictObject({
  version: z.literal(2),
  ...fields,
  continuationWindowId: z.uuid(),
  planSHA256: z.string().regex(/^[a-f0-9]{64}$/),
});
const schema = z.union([legacy, window]).superRefine((value, context) => {
  if ((value.kind === "team_aggregate") !== (value.reportId === null)) {
    context.addIssue({ code: "custom", message: "controlled_team_manifest_binding" });
  }
});
export type ControlledTeamManifest = z.infer<typeof schema>;
export function parseControlledTeamManifest(value: unknown): ControlledTeamManifest {
  return schema.parse(value);
}
export function controlledManifestWindow(value: ControlledTeamManifest) {
  return "version" in value ? value.continuationWindowId : null;
}
