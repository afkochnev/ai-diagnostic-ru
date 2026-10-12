# V2.1A — staged account foundation rollout

This is an operator runbook for a future, separately authorized **staging** rollout.
Preparing this document and running local checks does not authorize applying remote
migrations or deploying an application. Production rollout requires its own reviewed
release procedure after staging evidence is accepted. No staging or production
migration, deployment or remote migration-ledger write was performed during the
commit partitioning work.

## Immutable release references

- Reconciled baseline: `0996971bfeac4ab50136998307169f6c63be8f44`.
- Auditable implementation snapshot: `15f4159cc4ee52e93ab440f5eea51e076bbb286d`,
  branch `codex/v21a-account-foundation`; preserve this branch unchanged.
- Rollout branch: `codex/v21a-account-foundation-rollout`.
- Commit 1, database expansion: `c892fc8ea4bf61a4f96959169972b63dbfe01ca0`.
- Commit 2, compatible application: `15f36e6ab1ed5229618b34fa3270eca2c47da5ea`.
- Commit 3, authorization cutover: `<COMMIT_3_SHA_FROM_RELEASE_REPORT>`.

Commit 3's exact SHA is recorded in the release report because a commit cannot
include its own SHA in its committed contents. Resolve every release reference to
an exact SHA and record it in operator evidence before touching staging. Use a
dedicated checkout and the existing approved staging secret store; never paste
database passwords, service-role keys or provider tokens into evidence or logs.
Verify the CLI's linked project against the approved staging project immediately
before each dry-run and apply. Do not rely on whichever project a developer's
checkout happens to be linked to.

**Do not run `supabase db push` from the implementation snapshot or from Commit 3
against a baseline database.** Both pending migrations would execute consecutively
and skip the application-deployment and validation checkpoint. Migration files
must enter the deployable tree at their corresponding release checkpoint.

| Checkpoint | Checked-out tree | Staging ledger before command | Expected `db push --dry-run --linked --skip-vault` |
| --- | --- | --- | --- |
| Expand | Commit 1 | Original 30 entries, no account migration | Only `20261013000100_account_foundation.sql` |
| Application | Commit 2 | Original 30 entries plus Phase A | No pending migrations |
| Cutover | Commit 3 | Original 30 entries plus Phase A | Only `20261013000200_account_authorization_cutover.sql` |

Any missing, additional, reordered or unmatched migration is a **stop condition**.
Investigate through read-only evidence. Do not use `migration repair`, manually
INSERT/UPDATE/DELETE ledger rows, `--include-all`, or replay old methodology
migrations to make the pending list match. Do not rewrite any of the 30 baseline
migration files.

CLI checks were performed with repository-installed Supabase CLI **v2.117.0**.
Keep `--skip-vault` on both dry-run and apply: this release changes database
migrations only and must not synchronize unrelated Vault configuration. Do not add
`--include-seed` or `--include-roles`.

## Local release evidence and repeatable checks

The partitioning work verified Phase A with **19 clean/upgrade scenarios**, the
compatible application with **251 unit tests**, lint, typecheck and host production
build, and the full cutover with **20 clean/upgrade scenarios and 255 unit tests**.
The actual CLI pending lists were Phase A only, empty after recording A, and
Phase B only. These checks use disposable PostgreSQL and Auth SQL/JWT stubs;
they do not satisfy the separately authorized deployed-artifact staging gate.

To repeat the CLI ledger checks on the three exact commits, create a dedicated
loopback-only PostgreSQL container, wait for readiness, and substitute the release
report's full Commit 3 SHA into the `V21A_CUTOVER_SHA` shell variable:

```sh
docker run -d --name ai-diagnostic-v21a-rollout-ledger \
  -p 127.0.0.1:55431:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
V21A_CUTOVER_SHA='<full Commit 3 SHA from the release report>'
python3 scripts/test-account-rollout-local.py \
  --phase-a-ref c892fc8ea4bf61a4f96959169972b63dbfe01ca0 \
  --app-ref 15f36e6ab1ed5229618b34fa3270eca2c47da5ea \
  --cutover-ref "$V21A_CUTOVER_SHA" \
  --ledger-container ai-diagnostic-v21a-rollout-ledger --port 55431
docker rm -f ai-diagnostic-v21a-rollout-ledger
```

The trust setting is confined to this disposable loopback test endpoint. The
runner refuses remote URLs/project selectors, other container prefixes and
non-loopback port bindings. It materializes committed Supabase trees, creates one
random database, records migrations through the real CLI and checks every dry-run
leaves the local ledger unchanged. Original ledger rows must survive the local
30 → 31 → 32 transition exactly. It also verifies ancestry, migration-file hashes
and the final tree's explicit rollout-documentation/test exceptions. Only its own
random database and temporary trees are removed by the runner.

See [the exact per-commit file manifest](../architecture/v2-account-foundation-files.md).

## 1. Establish the staging checkpoint

1. Confirm that methodology reconciliation is already complete: manageability v3
   is retired and v4 is published. Preserve their version IDs, status, content
   hashes, child rows and all existing diagnostic version references. If staging
   differs from the approved reconciled baseline, stop this rollout; reconciliation
   is a separate task.
2. Record the current V1 application deployment SHA and retain its artifact, record
   staging project identity, obtain a verified recoverable database backup, and
   record the restore procedure. Retain the compatible Commit 2 application
   artifact before beginning Phase B.
3. Use a short reviewed staging write pause around each migration: pause test
   traffic, background jobs and scheduled work that mutate relevant rows. Do not
   perform user cleanup. Run the before/after historical comparison immediately
   around the migration, before starting browser smoke tests. Expected app/Auth
   writes from smoke tests need a separate labeled fixture/evidence checkpoint.
4. Export the full `supabase_migrations.schema_migrations` ledger, including stored
   statements/names where present. Preserve the original 30 entries exactly;
   applying a migration through the CLI may append only its new entry.
5. Save the policy, constraint, index, trigger, function and grant catalogs. Include
   `pg_policies` expressions/permissiveness, `pg_constraint` definitions/validation,
   `pg_attribute.attnotnull`, `pg_indexes`, `pg_trigger`, routine definitions and
   privileges for all account/company/diagnostic/report/request tables. The full
   pre-A policy catalog is the reference for the exact legacy policies retained
   through Commit 2 and removed during Phase B.
6. Capture a stable historical-row inventory from every existing `public`,
   `private` and `auth` table. Save exact row projections sorted canonically,
   their IDs, counts and hashes. For `company_profiles`, omit only `account_id`
   from both projections so the expected additive attachment does not count as a
   rewrite. Preserve all other fields, including revision and timestamps.
   Accounts/memberships are new tables and receive a separate mapping inventory.
   Snapshot methodology v3/v4 and all their translation/block/question/scoring/
   maturity children exactly; published/retired status and headline content_hash
   alone are insufficient. Include answers, mutations, snapshots, results, block
   results, AI report revisions, artifacts, email deliveries, leads, feedback,
   jobs and audit history. Read-only snapshots may contain personal data and must
   remain in the approved restricted evidence location.

Useful read-only catalog checks, executed through the approved staging SQL
connection and saved as operator evidence:

```sql
begin read only;
select * from supabase_migrations.schema_migrations order by version;
select * from pg_policies
 where schemaname='public'
 order by tablename, policyname;
select c.conname, c.contype, c.convalidated, pg_get_constraintdef(c.oid)
 from pg_constraint c
 where c.conrelid=to_regclass('public.company_profiles')
 order by c.conname;
select a.attname, a.attnotnull
 from pg_attribute a
 where a.attrelid=to_regclass('public.company_profiles')
   and a.attname='account_id' and not a.attisdropped;
select v.id, v.definition_id, v.version_number, v.status, v.content_hash
 from public.diagnostic_versions v
 join public.diagnostic_definitions d on d.id=v.definition_id
 where d.key='manageability' and v.version_number in (3,4)
 order by v.version_number;
commit;
```

## 2. Commit 1 — apply Phase A while V1 still runs

1. Check out the pinned Commit 1 in the staging migration checkout. Verify its
   parent is the reconciled baseline and the complete migration-directory diff
   adds only `20261013000100_account_foundation.sql`. Verify the Phase B file is
   absent and the 30 baseline files have identical blob hashes.
2. Run the installed, approved CLI's dry-run and save its complete output:

   ```sh
   ./node_modules/.bin/supabase db push --dry-run --linked --skip-vault
   ```

   Proceed only when exactly the Phase A filename is pending. Reconfirm staging
   identity and the future rollout authorization, then apply from the same
   unchanged Commit 1 checkout:

   ```sh
   ./node_modules/.bin/supabase db push --linked --skip-vault
   ```

3. Capture the immediate after-migration history snapshot. Every old row and ID
   must match its before projection, with `company_profiles.account_id` as the
   sole additive company value. Original ledger rows must match exactly, with one
   appended Phase A entry. V3/v4 and every child projection must match exactly.
4. Verify the expansion contract: accounts and owner memberships exist; every
   existing public user has exactly one legacy-origin account and active owner
   membership, including users without companies; every existing company points
   to the account whose legacy origin matches `owner_user_id`; no NULL account_id
   remains in the actual backfilled data. The column remains schema-nullable, its
   FK remains NOT VALID, and `company_profiles_owner_user_id_key` still exists.
   All original company/diagnostic/report policies and RPC authorization remain
   unchanged; only the two new tables have new account SELECT policies.
5. Verify account/member invariants, indexes and grants: one active owner per
   active account, owner as the sole role, restrictive FKs, unique immutable
   legacy origin, immutable keys and no authenticated INSERT/UPDATE/DELETE or
   provisioner/backfill EXECUTE grants. Use read-only catalog checks rather than
   replaying the backfill or modifying staging owner state.
6. Resume isolated staging traffic and validate the still-deployed V1 artifact
   with approved staging test identities: existing profile/history access,
   existing in-progress diagnostic save/submit, completed result/report/PDF,
   pinned retired-v3 diagnostics and published-v4 creation. Also test signup and
   first-company creation using the original V1 INSERT shape that omits
   account_id. No existing ID or history record is replaced. Label every new
   test-created identity/diagnostic separately in evidence; keep its data intact.

Remain at Phase A if any assertion fails. Do not apply Phase B to compensate for
an expansion defect.

## 3. Commit 2 — deploy and validate the compatible application

1. Check out the pinned Commit 2. Phase B must still be absent. With Phase A
   recorded in the real staging ledger, run `db push --dry-run --linked --skip-vault` and
   require **no pending migrations**; do not run an apply command at this step.
2. Deploy the exact previously validated Commit 2 artifact to staging through the
   project's approved deployment process. Deployment is a separate authorized
   operator action. Record the deployment ID, exact code SHA and runtime health
   so Phase B cannot rely merely on a successful local build or a checkout SHA.
3. Test the application against the actual **Phase A** schema: zero/one-company
   routing, explicit company/profile/diagnostic paths, company query selection,
   profile revisions, save/replay/submit conflicts, results, report reads, PDF
   cache/coalescing authorization, email/AI authorization and plural admin views.
   Verify unauthenticated, unverified and foreign-account denial, cookie user-ID
   binding, and global administrator-without-membership denial on user paths.
   Existing V1 users must retain access to all their available history. Read a
   retired v3 diagnostic through its pinned methodology, and create new staging
   diagnostics only against the already published v4 methodology.
4. Verify that populated accounts have no additional-company creation control.
   Do not create additional companies for real users or enable commercial/team
   features. Multi-company RLS and controlled owner-state cases belong to
   disposable local fixtures or a separately approved synthetic staging fixture
   after Phase B; never transfer/archive/revoke existing owners for a smoke test.
5. Between Phase A and B, retain the legacy creator-to-owner mapping. No owner
   transfers, account archiving/revocation, account reassignment or manual state
   repair is allowed in this window: legacy DB policies are still creator-based
   while the deployed server additionally checks current account membership.
6. Require a recorded staging validation sign-off for the **running Commit 2
   artifact with Phase A**, including real Supabase Auth/PostgREST behavior and
   healthy web/worker integration. Record a usable Commit 2 rollback artifact.
   This sign-off is the gate for moving to Commit 3. A CI green check alone does
   not satisfy it.

## 4. Commit 3 — apply Phase B after the application gate

1. Confirm the signed Commit 2 staging checkpoint is still current and the
   compatible application is running. Pause staging writes/workers briefly and
   take another immediately comparable historical checkpoint and backup. Account
   owners/mappings must still match the original backfill contract; Phase B
   verifies it and intentionally fails on inconsistent operator changes.
2. Check out the pinned Commit 3. Run `db push --dry-run --linked --skip-vault`; require only
   `20261013000200_account_authorization_cutover.sql`. If Phase A also appears,
   stop: either the checkout/project/ledger is wrong or Phase A was not applied.
   Do not repair or manually advance the ledger. Under the separate staging
   authorization, apply from that same checkout with `db push --linked --skip-vault`.
3. Compare immediate before/after snapshots: all historical IDs and full old row
   projections unchanged, including methodology v3/v4; all original ledger rows
   plus Phase A unchanged, with only Phase B appended. Capture the final account
   mapping inventory and ensure no mapping or membership was silently replaced.
4. Verify contract/cutover catalogs: company account FK is validated and
   `account_id` is NOT NULL; only the old one-company-per-owner unique constraint
   was removed, while its useful nonunique index, company PK and incoming history
   FKs remain. Compare complete pre/post constraint catalogs, not just counts.
5. Verify every replaced legacy authority policy is absent and exactly the
   expected membership/requester policies are present. Do not accept old policies
   alongside new permissive policies: their OR combination would preserve a
   bypass. Check company, diagnostics, answers, mutations, snapshots, results,
   block results, reports, artifacts, email, lead/consultation and feedback
   policies. Verify the updated save/submit/lead/feedback RPC bodies and grants,
   and membership-aware pinned retired-methodology read helpers.
6. Resume staging traffic; repeat the Commit 2 functional/security smoke tests
   with the same compatible artifact and actual final schema. In disposable
   fixtures, verify several companies in one account, cross-account IDOR denial,
   revocation-before-idempotent replay, pinned retired methodology visibility,
   signup atomicity and old INSERT-without-account_id compatibility. Membership
   state changes must be transactionally valid and confined to synthetic fixture
   accounts; no existing owner mapping is changed. Ensure no real-user extra-company
   control or excluded commercial/team capability has appeared.
7. Save release evidence: the three pinned SHAs, per-commit manifests, dry-runs,
   ledger/snapshot/catalog comparisons, deployment and smoke-test IDs, timings
   and lock impact. A final dry-run should have no pending migrations. Stop at
   staging; any production operation requires the later approved procedure.

## Stop and recovery rules

- A failed migration is transactional. Confirm its transaction rolled back and
  that no ledger entry was appended. If network loss makes the outcome uncertain,
  reconnect read-only and inspect schema and ledger before considering a retry.
  Never rerun blindly or fabricate a ledger entry.
- A mapping, methodology or historical-row mismatch is a stop condition.
  Investigate from retained evidence; do not force ownership, rewrite data,
  change v3/v4, run cleanup, or replay the historical migration chain.
- Before Phase B, leave the successful Phase A schema in place and restore the
  retained V1 artifact if needed; Phase A is designed for that application. No
  down migration or deletion of accounts/history is required.
- After Phase B, retain both account migrations and data. Recover application
  behavior with the recorded compatible Commit 2 artifact or a reviewed forward
  fix. Do not roll back to the old singular-company binary, re-add the old unique
  constraint, drop account tables/columns, or remove newly created companies to
  manufacture an old schema. A full backup restore is exceptional and requires a
  separate reviewed recovery decision that accounts for all subsequent writes.
- Do not invoke `private.backfill_legacy_accounts()` as routine post-rollout
  maintenance: after legitimate future ownership/account changes it deliberately
  rejects conflicts. Normal verification is read-only mapping/catalog comparison.
- Do not run the legacy creator-allowlist cleanup script at any account stage.
  Commit 1 preserves the V1 application and may still contain the old cleanup
  tool; account-aware deletion requires its separate reviewed procedure.

Local SQL/JWT-stub integration results are useful preparation evidence. They do
not replace the real staging Auth/PostgREST and deployed-artifact gate above.
