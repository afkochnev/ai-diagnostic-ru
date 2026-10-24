# Controlled Team continuation W2

The subsequent protective change is specified in
[W2 Auth evidence and finite operator integration](v27-team-w2-auth-evidence.md).
Its durable wire trace is mandatory for W2 issuance and verification; earlier
hash-only completion is insufficient. Local/mock acceptance authorizes no rollout.

This guard is implementation only. It does not open a window, deploy a service,
change environment values, grant Advanced, or authorize another external call.
Acquisition, Team and billing remain OFF. No merge or production rollout is
included. The previous run, Team, recipients and spent receipts remain evidence.

## State and preservation

One private continuation row is linked to an existing, stopped, compensated
root run R. It admits the same open Team and its three invited participants,
existing unconfirmed Auth UIDs, invitation hashes and pending nonce bindings.
Creating another ordinary run or restarting R does not resume the cohort.

W2 begins `prepared`, with no clock or effects. A separate operator arm operation
checks the immutable approved plan hash and cohort again, then sets an immutable
60-minute expiry using the database clock. Personal verification closes at
20 minutes. Stopped or expired windows cannot extend or renew themselves.
The default migration inserts no window and changes no launch/billing switch.

After W2 preparation a trigger freezes all original R fields. Historical effects,
invitation hashes/expiry, consent/legal records, old plan grants and audits are
not rewritten. W2 holds its own report/source/deadline/claim and manual plan
pointers. The real authenticated administrator grants a new Advanced using an
exact subscription compare-and-set. Compensation appends a new Free subscription
and audit; it never restarts or backdates the earlier subscriptions. Unexpected
provider/admin intervention stops compensation.

The W2 row is also a permanent one-shot tombstone: the legacy run configurator
and selected-policy UPDATE/DELETE cannot select a fresh budget root in prepared,
active or stopped/restored states. The configurator rechecks after taking the
shared policy lock. These three finite operator configuration/arm APIs require
READ COMMITTED; older snapshot isolation is refused before mutation. Any future
independent controlled run needs a separately reviewed mechanism.

## Existing invitation access

The original three Auth issuance and three email receipts remain spent. Generic
create/invite/renew and old Auth slots are refused while W2 exists. A dedicated
operator entry point handles one existing participant, with separate root-keyed
`reauth_link` and `access_email` slots, each at most once per participant.
These six additional effects require later explicit owner authorization; shipping
this source does not authorize them.

`scripts/controlled-team-w2-access.ts` accepts a private regular non-symlink JSON
manifest (no group/other access, at most8KiB), containing only:

```json
{
  "version": 2,
  "operation": "participant_access_recovery",
  "runId": "<existing root UUID>",
  "continuationWindowId": "<W2 UUID>",
  "teamId": "<existing Team UUID>",
  "participantId": "<one existing participant UUID>",
  "expectedSHA": "<separately accepted canonical SHA>",
  "planSHA256": "<separately approved execution plan hash>"
}
```

The manifest and DB context must agree before any effect. Protected service/Auth/
Resend configuration stays in the runtime environment. A single fresh magiclink
must return the exact prebound UID and email with the expected verification type;
otherwise the request is spent and stops. There is no Auth SMTP, generic signup,
metadata/nonce replacement, raw invitation-token recovery, OTP fallback, retry or
automatic resend. Native effect transports reject unexpected URLs, redirects and
SDK repeat dispatches. Do not use credential issuance as a readiness probe.

The new purpose-separated encrypted proof binds root/window/Team/participant/UID/
email/invitation hash and fresh Auth token hash. It lives only in memory and the
recipient's link, then an HttpOnly cookie. It cannot revive an expired old proof.
The closed landing page reveals no token, run id or resend control.

The person submits the current required consent themselves. Only then does the
server reserve the single W2 verification attempt and apply the natural current
rate limit, before Auth verification. It does not pre-reserve a ten-minute bucket
while waiting. The hash-only authenticated finalizer requires that same UID and
verification row, current legal versions and consent; marketing remains false.
Organizer access remains status/aggregate only, without personal answers/scores.

## Aggregate, AI and PDF

The strict original six-key manifest remains supported as v1; it cannot claim a
W2 job. The v2 aggregate/report manifest adds `version:2`,
`continuationWindowId` and `planSHA256`. Claims, job scope, prepared input and
every AI reservation must match the root, window, report and source. Old root-only
RPCs reject W2. Ordinary workers cannot claim these jobs.

Aggregate/report flags and deadline are recorded in W2, while durable effect
uniqueness remains keyed by R across the entire history. Starting another process
or changing a window directory does not restore an allowance. The unchanged
maximum is one aggregate job, one report job, one model GET and four Responses
stages, each once: synthesis6000, optional synthesis repair6000, main14000 and
optional report repair6000 output cap parameters. Payload128KiB, generation540s,
Responses timeout180s, modelGET20s and lease margin60s remain enforced. These
technical limits do not assert a monetary ceiling. One completed report/version
may prepare one PDF; historical ready PDFs remain readable and immutable.

`controlled-window-dispatch.ts` builds reviewable commands/manifests offline.
Its injected atomic journal is rooted at R, outside per-window paths, for the
aggregate/report Render POST reservations. The adapter must reconcile all old
dispatch evidence and implement durable exclusive create; an unknown POST is
spent. Report dispatch requires the aggregate terminal proof first.

Readiness includes the exact SHA/plan/source/environment fingerprint, genuinely
stopped current worker instance and absence proof, two empty global drains at
least15s apart, no unrelated eligible work, all generic and financial gates OFF,
and at least12min remaining before the report dispatch. Terminal proof combines
Render success with the exact DB target completed at attempt1 and no lease.
No numeric process exit code is invented when the provider does not expose one.

## Containment

Stop W2 admission first. R remains stopped. An effect already dispatched remains
spent; no error or ambiguous outcome permits another attempt. Failure can clear
only a genuine owned, unexpired lease. The narrow queued-job terminalizer operates
only on this stopped W2's unclaimed attempt0 with both lease fields null; it cannot
steal a live/unknown lease, requeue work or cancel unrelated jobs. First stop time
and reason are preserved through later cleanup.

After safe target terminalization, compensate only the exact W2 manual grant,
restore full environment/Auth preimages, check preservation and all queues/leases,
then resume the ordinary worker once and verify the actual process and stable
post-resume snapshot. Maximum future pause is75min. Render may create a new
`service_resumed` deployment; qualify only genuine owned artifacts and the exact
canonical SHA, never a blanket metadata exclusion. An unresolved lease, effect,
Auth/consent/ownership change or restore mismatch is HOLD.

## Acceptance and later permissions

Local tests use fake fetch and a disposable networkless PostgreSQL database with
no cloud credentials. They check rollback/additive preservation, ACL/RLS, prepared
and closed defaults, expiry, races, old-proof denial, exact UID/consent, root-level
budgets, subscription CAS, privacy, PDF and containment. The old v1 SQL suite is
retained; CI adds the W2 suite separately.

Local/mock PASS is not staging acceptance or provider acceptance. A future owner
approval must pin the exact PR head and migration hash before any staging rollout.
Only that exact new migration may appear in the dry-run, with gates OFF and
existing staging environment/secrets preserved. No real email/AI/YooKassa is part
of staging acceptance. A separate canonical production guard rollout and then a
separate W2 execution package are still required. Do not reuse old frozen operator
scripts by changing their SHA, reset the earlier Free/Team budget, merge billing
PRs, install a YooKassa secret or start phase3.

Sources: [Supabase generated links](https://supabase.com/docs/reference/javascript/auth-admin-generatelink),
[passwordless expiry](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[database function security](https://supabase.com/docs/guides/database/functions).
