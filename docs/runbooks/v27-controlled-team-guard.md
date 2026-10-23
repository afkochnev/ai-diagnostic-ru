# Controlled Team guard — V2.7

This change prepares a single controlled Team diagnostic. It does not activate Team,
change any deployed service, or authorize external calls. Production acquisition,
Team and billing switches remain OFF. The authoritative commercial configuration
remains `productionEnabled=false`.

## Boundaries

The database is the admission boundary, including direct Supabase RPC requests.
A private operator-configured run binds one Account, its Company and verified
owner, exactly three distinct recipient addresses and an expiry. The model is
pinned to `gpt-5.6-sol`. No browser or authenticated user can configure a run. New Team mutations
fail closed when no authorized run is active. Existing ownership, entitlement,
consent, RLS and privacy checks remain additional requirements.

Creating a Team binds the one allowed Team id atomically. Creating or renewing a
fourth invitation, requesting a foreign Team, changing the source or requeuing a
failed report must not open another allowance. Closing global creation/invitation
switches closes admission, including new Auth/email reservations. Stop the private
run to deny all new effect reservations and work RPCs. An already dispatched
request remains spent and may complete; no switch retracts it. The private run
expiry also protects direct RPC.
Neither switch deletes historical responses, reports or artifacts.

## External effects

Each controlled invitation requires separate durable reservations before generating
an Auth credential and before the single email send. Ambiguous outcomes remain
spent; there is no OTP fallback, resend or automatic renewal. Personal consent is
still required. New participants receive their own Free identity/Account and no
membership in the organizer's Account.

Only the isolated target runner may claim a controlled aggregate/report job. A
normal worker must not compete for it. Target id, source fingerprint, pipeline,
provider and lease token are checked before processing. The supported pipeline is
the existing `TEAM-RU-3`; research pipelines and mock fallback are out of scope.

The maximum is one model GET and four Responses dispatches: synthesis, optional
synthesis repair, main report and optional report repair, each at most once. The
budget is persisted before network dispatch and survives crashes, retries and
replica changes. A reservation is never released to retry an unknown request.
Controlled AI uses native fetch without an SDK retry layer, with redirects rejected. Serialized payloads are capped
at 128 KiB. Output caps are 6,000 tokens for synthesis/repairs and 14,000 for the
main report, a maximum of 32,000 across the four stages. No price ceiling is
inferred from those technical caps.

A single generation deadline is persisted from the first claim, at most 540
seconds and at least 60 seconds before the initial lease expiry. Restart, reclaim
or lease renewal cannot extend it. Each HTTP timeout is bounded by 180 seconds
and the remaining safe time. This bounds AI dispatch and result acceptance;
bounded receipt/failure/stop RPCs can finish later. Error results from publish/fail RPCs must not be
reported as successful containment. Live or unknown leases are never stolen or
cleared as cleanup.

The web request path validates the configured provider/pipeline without requiring
an OpenAI key. Only the executing worker validates and uses its protected key.
This does not add a key to web or make a provider request from the browser/server
action.

## Isolated runner entry point

`scripts/controlled-team-worker.ts` accepts one private JSON manifest path. It
requires a regular, non-symlink file with no group/other access and at most 8 KiB.
The manifest contains only `runId`, `teamId`, `sourceFingerprint`, `kind`,
`reportId` and `expectedSHA`; credentials belong only to the protected worker
environment. `kind` is `team_aggregate` or `team_ai_report`, and `reportId` must be
null for aggregation. Run it with the canonical Node runtime and `--import tsx`.
The deployed commit must match `expectedSHA` exactly.

The entry point performs one exact claim and exits. Its Supabase transport permits
only the reviewed RPC endpoints on the production project, uses a 30-second timeout,
rejects redirects and has no retries. Cleanup RPCs may run after SIGTERM to record
the owned attempt; they do not claim new work. `CONTROLLED_TEAM_STOP_HOLD` means
cleanup is unproved and requires inspection. It never authorizes another invocation.
All effect rows and leases must be inspected before any separately approved recovery.

This is an operator entry point, not an activation command. It requires a separately
approved configured run and runtime switches; it is deliberately unusable with
this PR's closed defaults. Do not execute it during local acceptance against a
remote project. Tests inject fake fetch/RPC implementations instead.

## Data and entitlement checks

The current minimum of three eligible completions and ordinary privacy validators
(including the 32-character overlap rule) are unchanged. Organizers receive
invitation status and aggregate statistics, never another person's raw answers or
individual scores. Aggregation uses population standard deviation on the relevant
scale; overall deviation is calculated from per-person weighted overall scores,
not an average of block deviations.

Only one PDF preparation is allowed for the bound completed report/version.
Existing ready PDFs remain immutable and authorized historical reads are retained.

Temporary Advanced uses the authenticated, audited administrator contract. A
guarded compare-and-set must bind the exact active subscription while holding the
Account lock. Reversal appends a new manual Free assignment and audit; it never
rewrites the previous subscription or legal records. A provider subscription or
unexpected intervening change stops compensation.

## Local acceptance and future rollout

Run application tests with fake HTTP and no production credentials. Run migration,
ACL/RLS, race, durable reservation, expiry, rollback and preservation cases in
disposable PostgreSQL with `--network none` and no published ports. Historical
SQL suites retain their historical checkpoints; the new guard suite verifies the
latest schema and its closed defaults separately.

A local/mock PASS is not staging or production acceptance. Staging migration and
deployment, a later exact canonical rollout with all gates OFF, and the actual
three-email/AI/PDF smoke require their own explicit owner scope. No production
role grant, merchant configuration, payment, refund, mail or AI call is part of
this PR's implementation or tests.

Before any future controlled run, refresh exact deploy/env fingerprints, full
pre-existing row hashes, legal/consent history, schema/ledger hashes, backup
coverage and all queues/leases. Include accepted Free results in the baseline.
Require an actual stopped-process acknowledgement if the ordinary worker is
paused; Render's `suspended` API marker alone did not prove process shutdown in
the earlier Free run. Preserve that run's accepted HTTP/token caveat.

After a future run: close DB creation/invites first, then web creation/invites;
drain only approved work, close Team master/runtime, restore approved temporary
settings, safely reverse the matching manual grant, and compare all data again.
Billing remains OFF and no phase-3 operation is authorized.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[database functions](https://supabase.com/docs/guides/database/functions),
[OpenAI SDK](https://developers.openai.com/api/docs/libraries),
[Render deploy lifecycle](https://render.com/docs/deploys).
