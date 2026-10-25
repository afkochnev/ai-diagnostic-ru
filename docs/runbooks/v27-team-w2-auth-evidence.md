# W2 Auth evidence and finite operator integration

This is implementation and local/mock verification only. It does not authorize
staging acceptance, a production rollout, W2 execution or another provider call.
The current Team, its three participants, original six successful effects and
all used lifetime reservations remain unchanged. Team, acquisition and billing
remain OFF. This change allocates no window, recipient, credential or budget.

## Actual Auth request evidence

W2 issuance and personal verification now require a private durable wire trace.
The server reserves that trace before its single Auth HTTP dispatch, records the
actual fetch dispatch and response-header timestamps, and finishes the trace
before passing a successful response to canonical code. The request and private
response parsing share a maximum fifteen-second timeout. RPCs have a separate
five-second timeout. There are no transport retries or repeated trace writes.
Unknown writes and ambiguous HTTP outcomes remain spent and require STOP.

The raw Auth token hash never becomes an RPC argument, SQL statement parameter,
operator artifact, log or trace column. An unkeyed hash of it is also forbidden:
the provider value can be derived from an OTP and must not become an offline
guessing oracle. A purpose-separated HMAC binds the actual credential to the
root, W2, participant and prebound UID. The key is the exact existing service
Authorization header, used transiently inside Node and PostgREST. No new secret
or local HMAC key is installed or transferred.

The credential message is UTF-8, with LF separators and no final newline:

```text
aca-w2-auth-evidence-v1
credential
<root UUID>
<window UUID>
<participant UUID>
<prebound user UUID>
<actual Auth token hash>
```

The result is lowercase hexadecimal HMAC-SHA256. A separate fresh challenge
message binds the operation and reservation. A service-only capability RPC first
checks that Node and PostgREST see the same exact Authorization value. The future
staging acceptance must verify this read-only capability without issuing or
verifying an Auth credential. A rewritten/missing header, mismatch or unsupported
gateway behavior is HOLD; there is no fallback key or weaker digest mode.

The finite collector also checks the fixed Auth health endpoint's advertised
`v2.197.0` version before effects, because the accepted transition model was
derived for that version. This read-only metadata check is not binary attestation.
Version drift requires review; credential issuance is never used as a probe.

Issuance success requires its actual response credential to match Auth's stored
recovery credential for the existing UID. Verification admission requires the
actual submitted credential to match both that value and the successful issuance
trace. Completion requires the same identity, confirmed email and consumed
credential. The canonical effect completer and personal finalizer enforce these
traces in SQL too. An already-confirmed browser session cannot bypass this W2's
personal consent and verification. Direct private-table access is denied to API
roles. Successful traces cannot be replaced, reset or deleted.

Raw timestamps are retained. No clock-skew allowance is introduced in the Auth
RPCs. Database expiry is authoritative. The old zero-skew observation remains
HOLD. The operator defaults to zero tolerance; a proposed two-second forensic
comparison tolerance requires a separately approved plan and cannot rewrite the
captured times or relax an Auth/window deadline.

## Concrete operator boundary

`scripts/operator-w2/` integrates finite source, journal, transport, readiness and
preservation checks. Imports and construction are inert. There is no live CLI,
automatic credential loader, free-form URL, SQL, shell command or default fetch.
The caller must explicitly supply the transport, closure-held credentials and an
exact separately authorized future execution plan. Read-only mode rejects every
mutation. Local/mock mode cannot open the protected production journal.

The future plan must bind a new accepted canonical SHA/tree, critical source-file
hashes, full environment/Auth/configuration preimages, old effects, final baseline
after human session readiness, and the private fixture commitment. The old c375
SHA is rejected for execution of this new code. Actual GitHub main/tree and the
required `application`/`isolated-sql` checks are read, not supplied as PASS flags.

All reservations share the existing root directory and preserve pinned legacy
files. Exclusive private files are flushed before a mutation. Slots are keyed by
root, operation and existing participant, never by a replaceable window path.
There is no reset, overwrite or delete API. Malformed state, unknown provider
results and in-flight controls refuse further effects. The fixed admission-stop
operation remains the narrow kill switch; it grants no retry or forced resume.

Readiness collects actual bounded service, deploy, environment, one-off, instance,
Auth configuration, database and schema evidence. Worker suspension alone is
insufficient: the owned process must acknowledge stop and disappear. Two truly
global zero queue/lease observations must be at least fifteen seconds apart and
fresh before dispatch. A later exact target enqueue is checked separately.
Owned warm/restore deployment IDs and the newest successful build must agree.

The three access jobs must finish before any personal confirmation. Personal
consent and the administrator's subscription compare-and-set remain real human
actions; the operator neither impersonates them nor manufactures evidence. The
existing sixty-minute window, twenty-minute personal deadline, ten-minute access
cutoff, report margin, five Render jobs and lifetime effect limits remain in force.
Read-only checks, source changes or another process never restore spent slots.

## Preservation and migration

The additive migration creates a private wire-trace table and constrained RPCs.
It inserts no rows, grants no user privileges, changes no feature gate, and patches
only the two pinned canonical completion functions. Unexpected source preimages
abort the migration. No historical consent, legal, Team, Auth or payment row is
rewritten. The dedicated SQL suite runs in disposable PostgreSQL with
`--network=none`; existing security/regression suites remain in CI.

The read-only service-only capture uses one database snapshot and a fixed table
inventory. It compares keyed per-row/per-field commitments, Auth identity/security
fields including timestamps, roles, memberships, ownership, consent/legal history,
diagnostics, schema/trigger/function definitions, ledger, storage metadata, gates,
queues and leases. Safe facts are limited to the exact controlled scope; unrelated
rows still receive commitments but expose no raw values. Unmodeled changes HOLD.

Each finite W2 checkpoint admits only its source-shaped expected changes; a
caller-provided `preserved=true`, target-excluded drain or exit-code claim cannot
substitute for the captured rows and actual provider receipts. No Auth timestamp
waiver is inherited from an earlier run. This new capture algorithm needs its own
future before/after baseline and an independent bridge to the previously accepted
preservation evidence; it does not retroactively certify an old snapshot.

Later staging approval must pin the exact new PR head and migration hash, show
only this migration in dry-run, preserve existing staging configuration and TEST
mode, and use SQL/fake-HTTP evidence only. Merge, canonical rollout and W2 execution
still need their separate approvals. Production, billing PRs and phase 3 are outside
this change.

Provider semantics were checked against the primary documentation for
[Supabase function security](https://supabase.com/docs/guides/database/functions),
[Render environment updates](https://render.com/docs/configure-environment-variables),
[deploys](https://render.com/docs/deploys) and
[one-off jobs](https://render.com/docs/one-off-jobs). Environment save and deployment
are separate operations; stopping a base service does not prove its one-offs stopped.
