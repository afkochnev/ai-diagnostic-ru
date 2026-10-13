# Methodology lifecycle and production ledger reconciliation

Prepared 2026-10-12 for baseline `0b8c4acb6a1071e5be06268ba8216c4215036e84`.
This runbook prepares a separately authorized operator action. No remote repair,
retirement, deployment or cleanup was performed while preparing it.

## Evidence and cause

Staging (`vflgxgdwlftlyjslyrmo`) records migration `20260918000100`;
production (`fhvxqeaujjeiflanqsbg`) does not. Both record
`20260918000200`, `20260918000300` and `20260918000400`.
The exact operational reason the row was omitted is not determinable from the
repository or current ledger: neither contains deployment logs. Do not describe
an inferred failed/skipped deployment as a proved cause.

The observed ledger schema in both databases is exactly:

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| version | text | no; primary key | none |
| statements | text[] | yes | none |
| name | text | yes | none |

The inspected historical methodology entries have NULL `statements`. This is
consistent with operator-written ledger records, but does not establish which
operator command created them. No established repository ledger-repair runbook
was found. Preserve original migrations and historical entries.

The read-only reference inventory found **one staging diagnostic pinned to v3**,
with 12 answers and 15 diagnostic mutations; production has no pinned v3
diagnostics. All inventoried v3 result/snapshot/report/PDF/email/lead/feedback/job
counts are zero in both environments. The staging diagnostic and its existing
response/progress must survive retirement. Neither environment's incomplete v3
is repaired to make a historical attempt scoreable.
Version 3 is `d6e8c2e1-2f50-4f94-9b07-23c8d1f3a312` in both databases; migrations
still resolve by definition key/version number, never by this observed UUID.
Detailed metadata, recursive FK coverage, exact reference counts and canonical
v2/v4 comparison are recorded in
`docs/architecture/20261012-methodology-reconciliation-audit.json`.

Migration `20260918000100_methodology_ru_2_0.sql` assumes fixed source/target
UUIDs. The later `20260918000400_repair_methodology_versions.sql` resolves the
definition/version chain and reconstructs RU-2.0 plus complete version 4.
Production version 2 carries its `stage12-2f-ru-2-0-repair` provenance marker.
Running 00100 now can conflict with existing immutable published records and
would replay an obsolete environment-specific data path. **Do not execute its
SQL, use `db push --include-all`, or delete the local migration file.**

## Preparation and read-only checkpoint

1. Record operator, approver, repository commit, Supabase CLI version and
   production project reference. The locally inspected CLI is 2.117.0 and
   supports `migration repair --linked --project-ref --status`.
2. Confirm the target is production, not the checkout's default linked staging
   project. Use the explicit project reference in every remote command.
3. Obtain a verified backup/PITR checkpoint and record its ID/time. Save a secure
   ledger snapshot, application schema snapshot, canonical methodology hashes,
   version 3 metadata/reference counts and application-history row counts.
   Keep credentials and user content out of terminal/repository logs.
4. Freeze automated migration application for the repair window. Re-read ledger
   absence immediately before the operation; if 00100 already exists, stop and
   inspect it instead of overwriting it.
5. Run `scripts/audit-methodology-parity.sql` against both projects in READ ONLY
   transactions and compare the JSON with
   `node --import tsx scripts/compare-methodology-parity.ts STAGING_JSON PRODUCTION_JSON`.
   Both valid versions must be complete and logically equivalent; do not use
   `content_hash` equality as proof.
6. Verify `20260918000400` exists and the approved v2/v4 structure wording,
   translations, options, scoring configuration and maturity definitions match.
7. Inspect current ledger without repair:

   ```sql
   BEGIN TRANSACTION READ ONLY;
   SELECT version, name, cardinality(statements) AS statement_count
   FROM supabase_migrations.schema_migrations
   WHERE version BETWEEN '20260918000100' AND '20260918000400'
   ORDER BY version;
   ROLLBACK;
   ```

`migration repair` has no verified dry-run mode. Read-only preflight is the dry
verification step; do not execute repair as a test.

## Approved ledger-only operation

Only after separate operator sign-off, from a reviewed repository checkout with
existing secure CLI authentication:

```sh
./node_modules/.bin/supabase migration repair --linked --project-ref fhvxqeaujjeiflanqsbg --status applied 20260918000100
```

This is the supported ledger operation, not migration execution. Supabase
documents `applied` as inserting a history record and `reverted` as removing it:
[official CLI reference](https://supabase.com/docs/reference/cli/supabase-migration-repair).
Do not pass a secret through command arguments or paste it into chat. If secure
credentials are unavailable, stop. No custom columns or SQL format are needed.
The CLI may record parsed migration statements as provenance; that does not
mean those statements ran. Do not require NULL statements after CLI repair.

## Post-repair verification

1. Confirm exactly one ledger row for `20260918000100`, with expected migration
   name `methodology_ru_2_0`; compare every other ledger row with the checkpoint.
2. Confirm canonical v2/v4 hashes, all version metadata/statuses and v3 child
   counts are unchanged. Compare application-history counts and schema snapshot.
3. Run `migration list --linked --project-ref fhvxqeaujjeiflanqsbg`; 00100 must no
   longer be pending. The new 20261012 migrations remain pending until a separate
   approved retirement rollout; do not apply them through this ledger command.
4. Record repair timestamp, CLI output, verification results and approver.

## Ledger-only rollback

Only if the checkpoint proved the row absent and this operation created it,
and after confirming no later deployment depends on the repaired ledger:

```sh
./node_modules/.bin/supabase migration repair --linked --project-ref fhvxqeaujjeiflanqsbg --status reverted 20260918000100
```

Verify only that row disappeared and all methodology/application data is
unchanged. Keep migration application frozen: rollback makes obsolete 00100
pending again. Reconcile the ledger before any future push. This does not undo
00400 or retire/unretire methodology.

## Separately approved retirement rollout

The current trigger rejects every update/delete of a published version.
`published -> retired` is **not supported at the audited baseline**.
Review the proposed prerequisite
`20261012000000_allow_methodology_retirement.sql` first. It adds a one-way,
status-only transition and preserves immutable published/retired content.
Then review `20261012000100_retire_invalid_methodology_v3.sql`, which asserts
version 4 completeness, resolves logical identifiers, retires only version 3,
preserves `published_at`, and checks highest-published selection resolves v4.
Do not disable triggers or alter child data. Local rehearsal must demonstrate
pinned-retired reads and rollback on failed prerequisite checks.

Apply neither migration as part of this preparation stage. In a later approved
rollout, rehearse staging first, verify invariant snapshots/reference counts,
then authorize production explicitly. Retired v3 is a retained invalid artifact;
do not force the different historical child sets to match.

## Local validation commands

Use an isolated `postgres:17-alpine` container named with the
`ai-diagnostic-v21r-` prefix and no published ports. Never supply a staging or
production connection string to the local runner:

```sh
python3 scripts/test-methodology-retirement-local.py --container ai-diagnostic-v21r-lifecycle
V21R_CLEANUP_TEST_CONTAINER=ai-diagnostic-v21r-lifecycle npm run test:unit -- --cache=false
npm run typecheck
npm run lint
docker build -t ai-diagnostic-v21r:local .
```

The lifecycle runner creates and removes only randomly named test databases in
that disposable container. The optional cleanup tests send only an extracted
execute guard and harmless branch markers, never the cleanup script. Docker
build uses the committed Dockerfile's non-secret build placeholders and invokes
no real OpenAI or Resend provider.

## Operator sign-off

- Prepared commit / CLI version:
- Target project / environment:
- Operator / approver:
- Secure backup or PITR checkpoint / time:
- Preflight schema / canonical hashes / ledger snapshot:
- v3 reference inventory reviewed by:
- Ledger-only repair authorization / time:
- Repair outcome and postflight evidence:
- Separate staging retirement authorization / outcome:
- Separate production retirement authorization / outcome:
- Rollback authorization and outcome, if applicable:

V2.1A may resume only after every gate in
`docs/architecture/v2-historical-methodology-parity.md` passes. Preparing or
pushing these files is not authorization to apply them.
