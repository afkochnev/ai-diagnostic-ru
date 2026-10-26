# Render capture B dispatch: diagnostic fix, HOLD retained

The separately versioned storage-inventory-v2 attempt is spent. Its positive
capability and native A do not establish independent runtime B. The sealed
oneoff intent/HOLD and later empty job inventory cannot reconstruct the original
HTTP status or prove a Render failure cause. Do not retry, reset or relabel them.

The saved request uses the documented Jobs endpoint, startCommand and planId;
the documented 201 receipt was already allowed. No endpoint/payload correction
is justified by the retained evidence. The proven defect is loss of failure
evidence: the old helper merged credential/dispatch/HTTP/body/JSON errors into
the same generic UNKNOWN before recording the observed HTTP status.

The later v3.1 B slot is also spent: its retained observation is HTTP 400,
`UNKNOWN_SPENT_STOP`, with no validated provider ID. Its error body was not
read. Do not infer the provider's exact rejection reason, absence of a remote
job, or a completed B capture from that observation.

Offline comparison now proves another missing prerequisite: the saved staging
web config has `serviceDetails.plan=free`, and its full normalized config SHA-256
matches F0 through F3 of v3.1. Render does not support one-off jobs on Free web
services. The paid job override `plan-srv-006` does not establish eligibility of
the base service. This proves an ineligible base at F3; it does not recover the
unread HTTP 400 explanation. There is no evidence of a malformed request JSON
or a documented command-length violation.

`scripts/operator-w2/render-job-diagnostic.ts` prepares a staging-only transport
for a future separately reviewed operator. Import/construction is inert. There
is no CLI, default fetch, environment reader, persistent secret or budget store.
It is not wired into production/W2 transport or into the deployed runtime.
The fixed destination is only the staging web service Jobs endpoint. Callers
must still pin an approved body hash, exact source/plan/preimages, fresh readiness
and a separately authorized durable reservation. The module allocates no slot.

Construction additionally requires `baseServicePreflight`: an exact, plain data
projection `{observedAt, service: {id, ownerId, type, serviceDetails: {plan}}}`
from a trusted service read. It pins the existing staging web ID and workspace,
requires `web_service`, and admits only the reviewed public OpenAPI `paidPlan`
enum. Free, missing, unknown, custom and omitted legacy plans fail closed;
omission is conservative local policy, not a claim that Render rejects every
omitted plan. Extra fields and accessors are denied. `observedAt` must be a
canonical UTC timestamp with milliseconds, no more than 60 seconds old and not
in the future. This 60-second bound is a local safety policy. Freshness is
checked at construction, before spending/reserving anything, and again after
the dispatch guard immediately before POST. Caller mutations cannot replace
the validated projection.

The projection is not authentication or independently verified evidence. A
future operator must bind its trusted source and fresh capture to the approved
plan and revalidate current service/config in `checkPreDispatch`. The module
does no implicit metadata GET. There is no automatic plan upgrade, paid-service
creation, worker substitution or new budget. The proven Free base therefore
remains blocked. Changing compute/service or authorizing a future attempt is a
separate owner decision and must not reuse this spent B or its old source pin.

The caller supplies reserveIntent, checkPreDispatch and writeObservation. The
reservation and observation writers must use a new separately authorized,
append-only scope, including local failure evidence; never overwrite an old
intent, receipt, HOLD or budget record. The first two callbacks are awaited under the 30-second request deadline, with an
abort check before any subsequent fetch. The evidence writer is awaited under
a separate five-second deadline. A late/ambiguous writer never permits retry or
promotion from HOLD; its durable result needs separate reconciliation. The
single in-memory slot is spent before reservation and cannot be retried, even
if no fetch was invoked. The caller's durable journal must independently reject
reopening/reconstructing any spent attempt; this module cannot create authority
by being constructed again. No success-code broadening, redirect, fallback or
automatic request retry is added. 200/201 require the exact owned job receipt.
An accepted job is not a completed job or a verified native B capture.

Only enum stage/reason, observed numeric HTTP status, fetchInvoked and a validated
accepted provider ID leave the transport. fetchInvoked means the local fetch
function was called; it does not prove remote delivery. An HTTP status, once
observed, survives later body/UTF8/JSON/ownership failures. Error bodies are not
read or hashed. Raw headers, statusText, correlation IDs, caught error names,
messages/stacks, body/credential fingerprints and secret values are never
serialized. Body/time limits remain finite; persistence failure itself HOLDs.

Local tests inject fake HTTP only. They cover pre-dispatch failures, HTTP errors,
timeout before/after headers, bounded bodies, malformed receipts, sensitive
echoes, immutable construction, concurrent/duplicate calls and evidence-write
failure. They do not make a new capability/capture/job request or validate B.

HOLD remains `V27_TEAM_W2_EVIDENCE_CHANNEL_STAGING_HOLD_CAPTURE`. This fix adds no
acceptance attempt/slot and authorizes no staging/production rollout, migration,
W2 window/arm/Advanced/Auth/email/aggregate/AI/PDF/YooKassa operation. Team/billing
and all existing budgets remain unchanged. Any future hosted attempt requires
a new reviewed source/plan and explicit authorization; never replay this spent B.

Official references: [Jobs API](https://api-docs.render.com/reference/post-job)
and [one-off jobs](https://render.com/docs/one-off-jobs),
[Free service limitations](https://render.com/docs/free#other-limitations), and
[public OpenAPI](https://api-docs.render.com/openapi/render-public-api-1.json)
(reviewed 2026-10-26).
