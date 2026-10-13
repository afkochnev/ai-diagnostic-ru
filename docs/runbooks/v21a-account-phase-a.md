# V2.1A Phase A database expansion checkpoint

Base: `0996971bfeac4ab50136998307169f6c63be8f44`.
Preserved implementation snapshot: `15f4159cc4ee52e93ab440f5eea51e076bbb286d`
on `codex/v21a-account-foundation`.

This checkpoint contains only the new expansion migration and its local tests.
The V1 application is unchanged. `20261013000200_account_authorization_cutover.sql`
must be absent from the migration directory. Do not run `db push` from the original
implementation snapshot: it contains both pending account migrations.

## Expansion contract

- Add accounts, owner-only memberships and a nullable NOT VALID company account FK.
- Backfill every public user, including no-company users, using random account IDs
  with a unique immutable legacy origin; attach existing companies without changing
  their IDs, timestamps, revisions or history.
- Retain every existing RLS policy, public diagnostic RPC and owner uniqueness.
- Retain V1 signup/consent behavior and INSERT payloads that omit account_id.
- Do not expose additional-company creation or implement team/commercial features.

There must be no NULL account_id in actual backfilled data even though the catalog
remains nullable. Authenticated browser DML on accounts/memberships is denied.
Existing methodology migration files and v3/v4 data remain unchanged.

## Local verification

Create an isolated PostgreSQL 17 container with the `ai-diagnostic-v21a-` prefix,
no network and no published ports, then wait for PostgreSQL readiness:

```sh
docker run -d --name ai-diagnostic-v21a-rollout-tests --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
python3 scripts/test-account-phase-a-local.py --container ai-diagnostic-v21a-rollout-tests
docker rm -f ai-diagnostic-v21a-rollout-tests
```

The runner applies the original 30 migrations and only Phase A on clean and V1
fixture databases. It compares full historical rows, legacy policy/RPC catalogs,
constraints and principal visibility, then exercises original and explicit-account
first-company/profile paths, diagnostic save/submit, pinned retired methodology,
signup, replay and conflicting mappings. Auth is SQL/JWT-stubbed; no remote URL,
provider call or existing local Supabase database is used.

## Future staging checkpoint

No staging/production migration or deployment is authorized by preparing this
checkpoint. In a separately approved staging rollout, pin this exact commit,
verify the linked staging project, retain backup plus historical/catalog/ledger
snapshots, and require this dry-run to list only Phase A:

```sh
./node_modules/.bin/supabase db push --dry-run --linked --skip-vault
```

The original 30 ledger entries must already match the reconciled baseline. Stop on
any discrepancy; do not repair or manually edit ledger rows. Compare historical
snapshots immediately around the migration while writes/jobs are paused, before
functional smoke tests create new rows. The running V1 artifact must continue to
save/submit diagnostics and read all existing results/reports/PDFs.

After successful expansion, deploy the later compatible application checkpoint
and validate it against the actual Phase A schema before introducing Phase B.
Until cutover, do not transfer/revoke/archive owners or accounts, remap companies,
create additional companies, or run the legacy creator-allowlist cleanup script.
Legacy DB authority intentionally remains unchanged during this interval.

On an application defect before cutover, retain Phase A data and use the retained
V1 artifact. Do not delete accounts, replay methodology, fabricate ledger entries
or use a down migration. The final rollout checkpoint supplies the complete
staging runbook and all three pinned release references.
