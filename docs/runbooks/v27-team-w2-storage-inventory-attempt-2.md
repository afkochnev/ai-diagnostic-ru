# W2 storage inventory acceptance — attempt 2

This is a new staging-only acceptance attempt. The earlier derived-channel
attempt and its spent rehearsal/apply/capability/native/oneoff reservations remain
sealed. Their records are evidence of those requests; this runbook does not reset,
reuse or relabel any slot. A fresh exact candidate, CI, approved plan, baseline and
finite attempt namespace are required before any new request.

Production stays unchanged. Team and billing remain OFF. This work does not arm
W2, create a window, grant Advanced, issue or verify Auth credentials, send email,
call AI/YooKassa or generate a PDF. It does not authorize a production rollout.

## Exact capture contract

The native V2 envelope and purpose-separated evidence-key derivation are unchanged.
Migration 58 replaces only the existing three-argument native preservation capture.
Historical migrations are immutable. Capture contains exactly 122 source-listed
tables: the previous 116 plus these six managed storage tables:

- `storage.buckets_analytics`
- `storage.buckets_vectors`
- `storage.migrations`
- `storage.s3_multipart_uploads`
- `storage.s3_multipart_uploads_parts`
- `storage.vector_indexes`

There is no wildcard expansion. An omitted table, unknown 123rd table or changed
source-pinned managed-storage column inventory is HOLD. SQL resolves the six real
relations and requires their actual owner to be `supabase_storage_admin`; it does
not silently fall back to the application or current session owner. The existing
complete catalogue HMAC includes relation ownership and ACL information. No new
owner claim or raw OID is added to the public capture envelope.

Each included table retains its complete column list, every row-key commitment,
full-row commitment and every cell commitment. `storage.migrations` rows are data
for preservation purposes, not an allowed migration-58 delta. A change to one of
those rows, to any other managed-storage row/cell, to ownership, or to the
catalogue must HOLD. Auth timestamps, historical consents and all existing rows
have no new waiver. Ledger count is exactly 58 after the authorized migration.

## Fresh baseline and bounded proof

Capture a fresh complete unkeyed 122-table baseline before deployment. Compute
its full row count rather than copying the earlier 8,263 count. Preserve Auth,
roles/ACL, storage schema/data, legal history, all queues/leases, existing jobs,
Render configuration/environment and spent controls. Compare the dry-run capture
to that baseline exactly; after apply, admit only the exact reviewed function/ACL
replacement and ledger append.

The independently captured native A must contain those same 122 tables and the
same total rows as the fresh baseline. The readonly runtime manifest carries the
full semantic fingerprint plus `expectedRowCount` derived from that baseline and
cross-checked against A. The built staging runtime uses the same existing root
secret, actual build SHA and approved-plan context, performs only its single authorized
native B capture, then requires both the full fingerprint and total
row count to match. The runtime emits safe counts and the complete capture
commitment; it never emits the root secret, derived key, key fingerprint, header,
nonce or MAC.

There is exactly one capability request for this attempt, performed by the local
operator before native A. Runtime B makes zero capability requests and must not
claim a separately observed capability PASS. Its manifest has version 2, purpose
`STAGING_STORAGE_CAPTURE_ACCEPTANCE_V2`, and protected path
`/tmp/aca-v27-evidence-channel/storage-inventory-v2.json`.

Ambiguous outcomes spend their exact attempt and HOLD without retry. Complete
preservation and owned Render receipts are required after every accepted
transition. STOP after this staging acceptance. Canonical merge/deploy, W2 and
production activation are outside this bounded attempt; no earlier authorization
is inferred to extend its request budget.
