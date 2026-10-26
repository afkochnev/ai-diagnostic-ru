# Paid staging dispatcher: public Journal boundary

This is a local/mock adapter fix in draft PR #16. It does not authorize or run
paid staging acceptance. `executionReady=false`; the evidence-channel staging
status remains `V27_TEAM_W2_EVIDENCE_CHANNEL_STAGING_HOLD_CAPTURE`.

## Defect and replacement

The historical sealed v2 acceptance runner forwarded an HTTP intent to an old
artifact journal's generic `write`. That journal correctly refused an intent
write. Do not edit that historical runner or its journal, reinterpret the failure,
or reuse its spent GitHub operation. Its in-memory HTTP reservation attempt did
not establish a durable HTTP intent.

`scripts/operator-w2/paid-staging-dispatcher.ts` uses only the canonical public
lifecycle, with `read` and `inventory` for validation:

```ts
journal.reserve(slot, scope, requestSHA256, instanceId);
journal.receipt(slot, 'KNOWN_ACCEPTED', evidenceSHA256, jobId, httpStatus);
// After independently obtaining the actual owned terminal job evidence:
journal.terminal(slot, terminalEvidenceSHA256);
```

The adapter does not require or invoke an internal/generic `write`. Journal core,
its finite W2 slot union, migrations and evidence-key architecture are unchanged.
No fallback facade may implement these public methods through an old journal's
generic `write`.

## Order and failure behavior

The adapter awaits each prerequisite in order:

1. Validate private filesystem permissions.
2. Validate exact source SHA and required green CI.
3. Validate the actual journal inventory and absence of all three records for
   the caller's proposed slot.
4. Read fresh Render/Supabase metadata, including config/env commitments, gates
   and queues/leases, through the reviewed outer precheck collector.
5. Validate the exact paid staging web service and paid-base eligibility.
6. Call public synchronous `reserve` exactly once. Validate its return and the
   durable public intent readback, including request/plan/application binding.
7. Only then call the credential reader.
8. Send one bounded POST to the fixed staging web Jobs endpoint.
9. Persist the public receipt once. Ambiguity remains `UNKNOWN_SPENT_STOP`.
10. Independently collect terminal provider evidence and then call `terminal`.

Method references are captured at construction. Replacement of journal/precheck
methods causes HOLD before the replacement can run. Inputs are copied; scope and
request getters are rejected. The reviewed composition must pass trusted plain
top-level options and precheck callbacks. Import/construction has no default
fetch, credential loader, filesystem opener or hosted journal constructor.

Reserve failure permits zero credential reads and zero external calls. A partial
intent that survives a thrown reserve is spent and requires investigation. There
is no reset/delete/retry API. A receipt cannot precede an intent; a terminal
cannot precede `KNOWN_ACCEPTED`. Receipt persistence ambiguity never triggers a
second receipt attempt. A succeeded creation response alone is not terminal
evidence. Timeout/late responses cannot upgrade an UNKNOWN receipt.

## Fixed transport constraints

- Staging web: `srv-daiqfnrm8hqs73dtaf1g`.
- Workspace: `tea-daipgd67bikc739jftl0`.
- Base: exact `0.5c-512mb`, web service, Docker, Frankfurt.
- Live SHA must equal the caller's reviewed candidate.
- Metadata age at most 60 seconds, checked again before reserve, credentials and
  fetch; the outer paid-base precheck must verify all other approved preimages.
- Endpoint: the service's fixed Render Jobs URL; no arbitrary service/URL.
- Job plan: `plan-srv-006`; command bounded to 8,192 UTF-8 bytes.
- One POST, redirects rejected, maximum 30 seconds, response maximum 65,536 bytes.
- Creation receipt must bind exact service, plan, command and job ID.
- No credential or raw provider response/error is persisted in journal evidence.

The terminal method validates exact owned-job fields and timestamps. Network
provenance is the trusted outer collector's responsibility; callers must not
substitute a locally manufactured object for an actual terminal Render receipt.

## Future hosted composition requires separate review and authorization

The canonical Journal has production W2 slots. Paid acceptance must not cast an
`http-NNN` name into that union or spend a production W2 slot for staging. This
adapter is a typed public lifecycle port, not a new slot allocator. A future
versioned acceptance plan must supply an independently reviewed compatible public
Journal binding and a new unused acceptance namespace. Do not reuse the sealed
v2 runner, its GitHub slot, the original B slot, or the LOCAL_MOCK test slots.

Before any future execution, pin that composition, dispatcher source, exact
candidate SHA/CI, inventory preimage, metadata collector and terminal collector.
Obtain the separate owner authorization for the paid staging sequence. This
document creates neither an acceptance slot nor a budget.

## Local verification

Focused tests use the real unchanged `openRootJournal` in new private
`LOCAL_MOCK` directories with synthetic credentials and injected mock HTTP.
They cover durable reserve ordering, permission failures, partial intent,
orphan receipts/terminals, UNKNOWN no-retry, receipt failure, method substitution,
async precheck rejection, stale/foreign/free metadata, terminal binding, late
responses and byte-pinned legacy UNKNOWN B.

Actual historical journals are checked separately without opening or allocating
new hosted slots. Their hash manifests and the original `UNKNOWN_SPENT_STOP` B
remain immutable. No Render/Supabase/protected-credential operation is part of
this local verification. W2, Team and billing remain OFF; production is unchanged.
