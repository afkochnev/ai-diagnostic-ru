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

## Conditional fix boundary

Do not switch credential HMAC in this diagnostic migration. Only after the actual
staging comparison and preservation PASS may a separate additive migration change
the W2 credential HMAC key source to apikey, together with the matching Node code,
tests and capture/readiness algorithm documentation. Preserve the original
Authorization challenge for comparison. No weaker hash, fallback key, new secret,
history rewrite or budget reset is permitted. A new native capture requires its
own baseline and bridge; old HMAC snapshots cannot be retroactively relabelled.

Canonical merge/staging acceptance and a production guard rollout remain separate
gates. Production rollout requires a further explicit owner authorization with
all gates OFF. This document authorizes no real W2 execution.

Primary references: [PostgREST transaction headers and read-only STABLE RPCs](https://docs.postgrest.org/en/stable/references/transactions.html),
[Supabase API keys](https://supabase.com/docs/guides/api/api-keys).
