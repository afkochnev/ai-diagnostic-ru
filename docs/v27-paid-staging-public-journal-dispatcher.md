# Paid staging dispatcher: public Journal boundary

This is a local/mock dispatcher and dedicated staging Journal binding in draft
PR #16. It does not authorize or run paid staging acceptance. Hosted execution
remains disabled; the actual evidence-channel staging status remains
`V27_TEAM_W2_EVIDENCE_CHANNEL_STAGING_HOLD_CAPTURE`.

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

`KNOWN_ACCEPTED` means only that the provider accepted creation of the exact
bound job. It is not terminal success. The owner's clarified two-phase contract
preserves this order; terminal must never precede the accepted creation receipt.

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

The dedicated composition adds enforced terminal provenance. A locally
manufactured evidence object or hash cannot authorize a terminal record.

## Dedicated staging Journal and composition

`paid-staging-journal.ts` creates a fresh versioned namespace for one finite
staging `capture-b` slot, independently pinned to acceptance version, candidate
SHA, plan SHA256, staging service/workspace and exact request SHA256. It does not
import, open or modify canonical production Journal core or its W2 slots. Public
methods are exactly `reserve`, `read`, `receipt`, `terminal`, and `inventory`.
There is no generic write, reset, delete, overwrite or reopen API.

The base must already be private and owned; namespace directories are 0700 and
files 0600. Symlinks, hardlinks, foreign ownership, unexpected entries and changed
inodes/hashes fail closed. Creation and records use exclusive creation, file
fsync and parent-directory fsync with durable readback. Existing namespaces,
including an unused one, cannot be reopened. Partial persistence leaves a spent
namespace. A future version cannot silently reuse a historical slot.

`paid-staging-terminal.ts` owns a private, one-use proof registry keyed by the
actual Journal object and complete acceptance binding. It performs one bounded
authenticated GET to the exact accepted job URL. Only an exact succeeded job,
service, job plan, command and valid times can mint proof. Proof expires after
60 seconds; failed, canceled, pending, unavailable, malformed or ambiguous results
HOLD without rewriting the creation receipt. A second collector cannot retry.
There is no exported proof-mint or persistent secret.

`paid-staging-binding.ts` composes the dispatcher, owned Journal and collector.
Its `collectTerminal()` takes no caller evidence argument. The raw Journal's
terminal operation also consumes the private collector proof, so bypassing the
composition cannot authorize a locally fabricated terminal hash. The wrapper
latches HOLD on failures and never retries an uncertain dispatch or terminal GET.

HOSTED_STAGING uses captured native transport and rejects injected fetch/clock.
LOCAL_MOCK requires an explicit mock transport and cannot be promoted to hosted
mode or mint proof for a hosted Journal. Local tests never construct a hosted
namespace. Import/composition construction performs no network or credential
read; explicitly creating a Journal does create its new local namespace.

## Future hosted composition requires separate review and authorization

The canonical Journal has production W2 slots. Paid acceptance must not cast an
`http-NNN` name into that union or spend a production W2 slot for staging. This
dedicated `capture-b` binding supplies this public lifecycle for the Render job
boundary. It is not a full paid-base/deploy/capability/native-A execution runner,
a budget allocator, or authorization for those other operations. A future
versioned acceptance plan must pin its outer collectors and all separate allowed
operations, then create a new unused namespace for B. Do not reuse the sealed v2
runner, its GitHub slot, the original B slot, or the LOCAL_MOCK test slots.

Before any future execution, pin that composition, dispatcher source, exact
candidate SHA/CI, inventory preimage, metadata collector and terminal collector.
Obtain the separate owner authorization for the paid staging sequence. This
document creates neither an acceptance slot nor a budget.

## Local verification

Dispatcher regression tests use the real unchanged `openRootJournal`; binding
tests use the real new dedicated Journal. Both run in new private LOCAL_MOCK
directories with synthetic credentials and injected mock HTTP.
They cover durable reserve ordering, permission failures, partial intent,
orphan receipts/terminals, UNKNOWN no-retry, receipt failure, method substitution,
async precheck rejection, stale/foreign/free metadata, terminal binding, late
responses and byte-pinned legacy UNKNOWN B.

The dedicated Journal suite additionally checks namespace reuse, permissions,
symlinks/hardlinks/tampering, exact durable binding, public lifecycle ordering,
failed/canceled/unknown terminal outcomes, provider-ID mismatch, source/plan/request
mismatch, manufactured/cross-Journal/stale proofs, mock transport isolation,
accessor and method substitution, and unchanged historical B bytes.

Actual historical journals are checked separately without opening or allocating
new hosted slots. Their hash manifests and the original `UNKNOWN_SPENT_STOP` B
remain immutable. No Render/Supabase/protected-credential operation is part of
this local verification. W2, Team and billing remain OFF; production is unchanged.
