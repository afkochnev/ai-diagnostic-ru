# W2 Auth header diagnostic

Production stays on `7f02388b4bb1ddfc8f42717ea488a393bb1449e4` with
`V27_TEAM_W2_OPERATOR_READINESS_HOLD`. This diagnostic does not authorize a
production change, W2, temporary Advanced, a credential, email, AI, PDF or payment.
The original six Team effects and all spent reservations remain unchanged.

## Paired, read-only proof

The additive service-only `check_controlled_team_auth_header_capability` RPC
compares two HMAC-SHA256 values in one actual HTTP request:

- Authorization: the unchanged `private.controlled_team_auth_mac` implementation,
  whose Node key is the exact `Bearer ` prefix followed by the existing key.
- apikey: the exact `request.headers->>'apikey'` bytes, whose Node key is the
  existing `SUPABASE_SERVICE_ROLE_KEY` without a prefix.

The message remains UTF-8 with LF separators and no final newline:

```text
aca-w2-auth-evidence-v1
challenge
00000000-0000-4000-8000-0000000000d1
-
00000000-0000-4000-8000-0000000000d2
00000000-0000-4000-8000-0000000000d3
capability
-
<fresh random 64-hex challenge>
```

These three UUIDs are a diagnostic domain binding. They are not Team or Auth
records. Windows and reservations must be null. Every other scope, including a
real W2 scope, is rejected. The response must contain `diagnostic_only=true`.
The existing public Authorization challenge, wire evidence and preservation
functions are unchanged. This diagnostic is never accepted as W2 admission or
credential evidence.

The staging database has no configured controlled Team cohort. Its old public
challenge therefore denies scope before HMAC comparison. That denial is not a
false HMAC result. Reusing the exact private Authorization helper inside the
paired diagnostic makes the header comparison possible without creating a
fixture, copying production identities or issuing credentials.

`scripts/operator-w2/auth-header-diagnostic.ts` is an inert factory with a fixed
staging project. The caller supplies the existing protected key and fetch
explicitly. The key travels only in the two existing HTTPS headers; RPC arguments
contain only the scope, challenge and MACs. No key, key fingerprint, header, MAC,
raw error or raw body is returned as evidence. There is one POST per factory,
no fallback or retry, an 8 KiB response limit, strict response/scope parsing and
a thirty-second deadline. A durable exclusive attempt intent is required in the
external acceptance wrapper before dispatch.

## Staging sequence

1. Pin the reviewed PR head, green `application` and `isolated-sql` CI, exact
   migration bytes and all old migration hashes. Confirm only the additive
   diagnostic migration is pending.
2. Capture fresh full table fingerprints (including all Auth timestamps), static
   catalogue/roles/ACL, consent/legal history, schema, ledger, queues/leases,
   storage metadata, service/deploy and full environment/Auth-config fingerprints.
   Preserve existing staging configuration, including mock acquisition and TEST
   shop `1504416`; Team and billing stay OFF. Historical snapshots are anchors,
   not claims about fresh state.
3. Dry-run the exact migration transaction with ROLLBACK. Recheck preservation.
   No remote login-role rotation, new key or hosted fixture is needed.
4. Apply only the reviewed additive function and its new migration ledger entry.
   All old rows and functions must remain exact. No application deployment or
   environment change is needed to run the diagnostic helper locally.
5. Record one durable attempt, load the existing staging service key transiently,
   and run the single paired POST. Check HTTP status, both booleans and every
   echoed scope field. Do not export challenge/MAC/header material. The old
   canonical scope denial remains a separate observation, never a false match.
6. Capture and independently compare all data and configuration again. The only
   persistent delta allowed is the additive function/ACL and new ledger entry.

Only `authorization_matched=false` with `apikey_matched=true`, exact scope and
preservation PASS yields `V27_TEAM_W2_AUTH_HEADER_ROOT_CAUSE_CONFIRMED`: the
supplied Authorization representation differs at the SQL helper boundary while
the raw apikey representation matches. This is the accepted gateway/header
translation diagnosis; it does not identify a particular gateway hop, prove a
production result or satisfy the old W2 admission gate. Every other outcome,
scope denial, ambiguity or preservation drift is
`V27_TEAM_W2_AUTH_HEADER_DIAGNOSTIC_HOLD`.

## Second, bounded header-channel diagnosis

The first staging observation was HTTP 200, exact scope,
`authorization_matched=false`, `apikey_matched=false`, with preservation PASS.
It did not establish a usable credential-key channel. Do not repeat that spent
attempt or switch the W2 key source.

The second additive RPC, `inspect_controlled_team_auth_header_channels`, is
service-role-only, STABLE and bound to the same synthetic UUIDs, null window and
null reservation. It returns exactly seven fields: Authorization/apikey classes,
their presence, whether the actual Bearer payload equals apikey, whether the
request JWT role is service_role, and `custom_probe_matched`. JWT classification
means compact three-part syntax, not independent JWT validation. No header,
payload, fragment, length, fingerprint, challenge or MAC is returned.

Node classifies the existing protected key only as `sb_secret`, `legacy_jwt` or
`other`. In the single POST it adds a fresh independent 256-bit random
`x-aca-w2-probe` header. That value exists only in process memory and its HTTPS
header; it is never an RPC argument, receipt, log or artifact. Node and SQL use
it as the HMAC-SHA256 key for this diagnostic message only:

```text
aca-w2-header-channel-diagnostic-v2
challenge
00000000-0000-4000-8000-0000000000d1
-
00000000-0000-4000-8000-0000000000d2
00000000-0000-4000-8000-0000000000d3
capability
-
<independent fresh random 64-hex challenge>
```

The message is UTF-8/LF with no trailing newline. The probe is encoded as 64
lowercase hex characters in the header; both sides HMAC with those exact text
bytes. The challenge is independently generated and is not the key. Neither is
persisted by the operator. The protected service key remains only in the two
normal authentication headers, never in RPC arguments or evidence output.

`header-channel-diagnostic.ts` is an inert staging-only factory. Before `run()`,
the wrapper must durably reserve one exclusive attempt. Dispatch consumes it
even on timeout or an unknown response. The strict schema, 8 KiB limit,
30-second deadline, redirect rejection and no-retry rule remain in force.

The same full preservation sequence applies to this second migration, anchored
to the prior typed post-diagnostic snapshot. Only the new function/ACL and one
new ledger entry are allowed; all old rows, Auth timestamps, old functions,
environment, gates and reservations must compare exactly. No app deploy is
needed. Existing staging mock acquisition is preserved; Team/billing remain OFF.

Interpret only a valid, fully preserved observation:

- Custom probe false: `V27_TEAM_W2_REQUEST_HEADER_CHANNEL_UNSUITABLE_HOLD`.
  Stop attempts to use request.headers as a shared HMAC-key channel.
- Node sb_secret, SQL bearer_jwt and apikey jwt, both present, equal payloads,
  service_role and custom probe true:
  `V27_TEAM_W2_AUTH_GATEWAY_TRANSLATION_CONFIRMED`. This establishes changed
  downstream representation, without identifying a particular gateway hop.
- Any other combination: `V27_TEAM_W2_AUTH_HEADER_DIAGNOSTIC_HOLD`.

## Separate architecture decision required

Do not switch credential HMAC in either diagnostic migration. Even a successful
custom probe proves transport only; it is not a production security mechanism.
Stop after diagnosis. A safe W2 evidence mechanism needs a separate design and
review. If no header channel is suitable, that design must remove the dependency
on gateway headers, for example by evaluating a DB-issued one-time evidence
capability. Preserve both existing challenges and all W2 source bytes. No
fallback, weaker hash, unhashed secret, persistent new secret, history rewrite or
budget reset is permitted. Old HMAC snapshots cannot be retroactively relabelled.

Canonical merge/staging acceptance and a production guard rollout remain separate
gates. Production rollout requires a further explicit owner authorization with
all gates OFF. This document authorizes no real W2 execution.

Primary references: [PostgREST transaction headers and read-only STABLE RPCs](https://docs.postgrest.org/en/stable/references/transactions.html),
[Supabase API keys](https://supabase.com/docs/guides/api/api-keys).
