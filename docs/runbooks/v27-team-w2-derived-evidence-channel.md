# W2 derived evidence channel

The existing AUTH_FLOW_SECRET is the root secret. No new persistent secret or
Supabase credential fingerprint is introduced. Supabase service-role authentication
remains independently mandatory. This header is evidence material, not application
authentication or permission to run W2.

## Exact derivation and transport

Canonical context uses UTF-8, LF separators, no trailing LF:

```text
aca-w2-evidence-key
1
<controlled root run UUID>
<approved plan SHA256, lowercase64hex>
<exact canonical application SHA, lowercase40hex>
```

HMAC-SHA256 with the exact existing AUTH_FLOW_SECRET UTF-8 bytes produces32raw
bytes. There is no trimming, clock, random per-process secret or volatile context.
The actual runtime build is the strict existing RENDER_GIT_COMMIT; the reviewed
operator plan independently pins it. The approved plan hash comes from the window
for issuance/personal verification and from the separately authorized readonly
plan for pre-window acceptance. There is no invented database expected_sha column.

The pure module keeps key bytes and context in private WeakMaps behind an opaque
handle. JSON serialization of that handle exposes no material. Context checks
reject handles for another root/plan/build. The only serialization is the
transient HTTPS header:

```text
x-aca-w2-evidence-key: aca-w2-v1.<64lowerhex>
```

SQL requires exactly74ASCII bytes and decodes the64hex into32raw key bytes.
Node also MACs with32raw bytes, never with the ASCII hex. Header/key material is
never an RPC argument, environment value, journal/manifest field, GitHub text,
log or evidence artifact. No constant keyed keyId/fingerprint is emitted.

Challenge and credential messages retain their established purpose-separated
Auth domains; preservation retains distinct row/key/cell/catalogue/ledger domains.
The derived key adds explicit root/plan/build binding to every one of them.
Web, controlled access oneoff, personal verification and operator/readiness use
the same derivation. Runtime prechecks fail before consuming an Auth reservation
if the existing secret/build configuration is unavailable.

## SQL boundary and history

The additive migration installs private controlled_team_evidence_mac(text),
patches Auth challenge/credential and per-row/per-cell preservation MAC helpers,
and uses only the exact custom evidence header. Missing/malformed material cannot
produce a successful capability or Auth admission. Authorization/apikey never
serve as fallback keys. controlled_team_service() continues to require the real
service-role authenticated request.

The two prior diagnostic migrations remain unchanged. The final migration drops
both diagnostic RPCs and the old no-argument capture signature. Canonical capture
now takes only nonsecret root/plan/app identifiers. Native V2 includes algorithm
and explicit context, and omits keyId. No table, window, reservation, old effect,
credential, consent, role, membership or feature gate is reset or rewritten.

On configured production data the original stopped-root capture guard remains.
A separate strict unconfigured branch permits service-only readonly proof when
there is exactly the default unbound policy and no controlled runs/windows/effects/
verifications/Auth-wire rows. Team and financial DB gates must be OFF. It never
admits issue/verify, inserts a cohort or grants Advanced. Its project field is null;
the fixed staging HTTPS endpoint proves actual transport origin separately.
Existing staging anonymous/mock-acquisition configuration is preserved.

## Bounded staging acceptance

1. Pin clean PR head, all historical migration hashes and green application/
   isolated-sql CI. Capture full116table data/Auth/consent/schema/ledger/storage
   commitments, roles/ACL, Render/Auth/env/deploy/jobs/instances and expanded
   runtime queue/lease inventory. No Auth timestamp exclusion is allowed.
2. Dry-run only the final new migration with atomic full-preimage guard and
   ROLLBACK. Capture exact preservation. Apply only the pinned migration+ledger57
   in the same guarded transaction and validate the exact function/ACL delta.
3. Deploy only the exact reviewed candidate to staging web/worker. Preserve
   environment/secrets/gates and TEST shop1504416. Bind deploy receipts, health,
   instances and every metadata change to those owned transitions.
4. Reserve readonly attempts durably. The operator uses existing protected staging
   web configuration in memory, derives the context key, performs one positive
   canonical capability and obtains full native captureA.
5. Run one controlled web-service oneoff on that same exact built image/env. It
   imports the same runtime derivation factory as web/Auth paths, performs one
   readonly capability and obtains full native captureB. It validates all rows/
   cells in memory and compares the complete semantic data commitment to A;
   only safe context/counts/result leave the process. No derived key or constant
   key fingerprint is exported. Two independent process contexts thereby prove
   matching semantics on actual hosted data without Auth issuance/verification.
6. Compare full unkeyed preservation again. The sole DB delta is reviewed SQL/ACL
   and ledger; the sole Render delta is receipt-bound deploys and that terminal
   readonly job. No W2 window/effect/Advanced/Auth/email/AI/PDF/YooKassa is allowed.
   An ambiguous request consumes its attempt and HOLDs without retry.

Only complete actual PASS yields V27_TEAM_W2_EVIDENCE_CHANNEL_STAGING_PASS.
The owner has authorized canonical merge after this PASS. Confirm unchanged head,
required CI and merge tree, record merge SHA and its green CI, then deploy that
exact merge only to staging. App SHA/context changes on merge: bridge data and
schema with independent full-row SHA evidence, and obtain a fresh readonly pair
under the canonical context. Never compare/relabel old-context HMACs as a new key.

STOP after canonical staging verification. Production stays on the previous
canonical deployment with gates OFF. No production secret, webhook, billing or
PR11 change is part of this work. Production guard rollout requires separate
explicit owner authorization. Worker stop acknowledgement, instance absence,
two global drains at least15seconds apart and W2 execution remain later gates.
