# V2.7 staging evidence: finite failure-stage diagnostics

This candidate improves failure evidence only. The accepted creation of
`job-dbfp59l9el5s73816idg` remains spent and its acceptance remains
`V27_TEAM_W2_EVIDENCE_CHANNEL_STAGING_HOLD_CAPTURE`. A read-only diagnostic
confirmed its exact service/plan/command binding and provider status `failed`.
Its only retained log was the generic HOLD marker. The inner cause and whether
its one permitted remote capture POST ran are still unproven.

## Failure wire format

A failure may emit only the fixed prefix
`ACA_W2_EVIDENCE_READONLY_DIAGNOSTIC ` followed by canonical JSON with exactly
`version`, `layer`, `stage`, and `code`. Version is `1`; the layer is `outer` or
`inner`. Stage and code come from the finite source enums in
`scripts/operator-w2/evidence-diagnostic.ts`. An unknown exception yields
`UNCLASSIFIED_SAFE_HOLD`, without inspecting its message or properties.

The existing `ACA_W2_EVIDENCE_READONLY_HOLD_NO_RETRY` marker is retained and the
process exits unsuccessfully. No diagnostic record can authorize a terminal
record or promote a spent acceptance. Success remains exactly one existing
`ACA_W2_EVIDENCE_READONLY ` result line and no diagnostic stderr.

- Outer stages: `OUTER_INIT`, `MANIFEST_READY`, `CHILD_RETURNED`,
  `CHILD_EXIT_ACCEPTED`, `RESULT_VALIDATED`.
- Inner stages: `MANIFEST_VALIDATED`, `STAGING_SCOPE_VALIDATED`,
  `EVIDENCE_CLIENT_READY`, `CAPTURE_DISPATCH_RESERVED`,
  `CAPTURE_RESPONSE_VALIDATED`, `COMMITMENT_MATCHED`.
- `CAPTURE_DISPATCH_RESERVED` is a local boundary before the single capture
  operation. It proves neither provider dispatch nor response completion.
- Transport/SQL/schema failures remain `CAPTURE_READONLY_UNAVAILABLE`; this
  change does not invent finer provider distinctions.
- Loader failure may leave only an outer code. An inner diagnostic is forwarded
  only from the exact two-line canonical inner diagnostic + generic HOLD
  protocol. Arbitrary child stdout, stderr and exception objects are discarded.

No credential, derived key, credential hash/fingerprint/length/fragment, dynamic
path, exception text, raw request/response, or user answer is a diagnostic field.

## Candidate command integration

`buildStagingReadonlyEvidenceJobRequest({context,nativeA})` in
`scripts/operator-w2/evidence-readonly-command.ts` is an inert constructor for a
future, separately approved candidate validation. It validates the existing
122-table native A contract and binds the manifest, context, commitment and
fresh row count. It pins the staging project/root, manifest directory, exact
read-only child, one-capture pre-import guard, 30-second HTTP guard, 120-second
child bound and `plan-srv-006`. The containing command preloads `tsx`, loads the
canonical runner source from the image, and still must fit within 8192 bytes.
The shorter loader keeps diagnostics in reviewed source rather than enlarging
the bound command with inline implementation text.

The Docker allowlist includes only the three new helpers. Offline operator
transports, journal tools and tests remain excluded. CI checks the actual Docker
build context and imports these helpers with network access disabled.

The existing `AUTH_FLOW_SECRET` derivation, exact transient evidence header,
independent service-role authentication, capture validation and commitment
comparison are unchanged. There are no migrations, new secrets, fallback HMAC
channels, new budgets, reservation resets or automatic retries.

## Validation and stop boundary

Local tests cover every finite outer failure code, inner boundaries, strict
success compatibility, command binding/size, private manifest filesystem rules,
loader failures, child watchdog, malicious/error output suppression, and the
single capture guard after success or failure. Synthetic fixtures and fake HTTP
ports are used; no protected credential or hosted state is required.

This PR update does not deploy, read production state, execute capability/A/B,
create a W2 window, arm, grant Advanced, issue/verify Auth, send mail, run
aggregate/AI/PDF, touch YooKassa, merge the PR or downgrade staging. Team and
billing gates receive no writes. All old acceptance evidence and journal files
remain immutable; the old CLI source pin is retained as historical evidence and
its authorized new code version is recorded separately.

A future hosted validation needs a separately approved exact source, plan,
namespace, unused candidate-validation slots, fresh preservation baseline and
bound terminal collector. It cannot reuse the failed B or any previous HOLD
namespace. The present status is local diagnostic-fix readiness only; hosted
acceptance stays HOLD.
