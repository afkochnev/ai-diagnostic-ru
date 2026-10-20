# V2.4: future production rollout and containment

Status: preparation only. This document grants no permission to modify production.
The V2.4 task permits production SELECTs and migration `--dry-run` only. Temporary
legal documents (`temporary-ru-v1`) block rollout. Do not execute any write below
without a separate, explicit production rollout authorization and a final manifest.

This draft must be completed with the production read-only preflight, exact CLI
dry-run and isolated compatibility evidence after staging acceptance/consolidation.
An absent or unsuccessful evidence artifact is a STOP, never an implied PASS.

## Fixed identities and release gates

| Object | Identity |
| --- | --- |
| Production Supabase | `fhvxqeaujjeiflanqsbg` |
| Production web | `srv-dak57did0e5s73b1t0b0` / `ai-diagnostic-production-web` |
| Production worker | `srv-dak5rurl550s73a17l60` / `ai-diagnostic-production-worker` |
| Retained V1 artifact | `0b8c4acb6a1071e5be06268ba8216c4215036e84` |
| Phase A compatible application | `15f36e6ab1ed5229618b34fa3270eca2c47da5ea` |
| Phase A migration | `20261013000100_account_foundation.sql` |
| Phase B migration | `20261013000200_account_authorization_cutover.sql` |
| Final application/worker | exact canonical SHA in `release-manifest.json`; never infer from branch name |
| CLI / Node | Supabase `2.117.0` / Node `26.8.1` |

Evidence directory: `artifacts/v24-production-readiness/` beside the repository.
Required before a future rollout: accepted staging web/worker SHA, successful full
CI for the release, protected-data comparison, restored temporary staging role,
`production-readonly-preflight.json`, `production-dry-run.json`,
`production-compatibility-matrix.json`, `production-rollout-plan.json`, complete
migration hashes, and approved final legal versions. Auto-deploy remains off for
both production services. A merge to main must not deploy production.

## Preflight, backup, write pause

1. Obtain separate production authorization naming exact SHA, services, project,
   migration packages, legal versions and bounded smoke operations.
2. Repeat the read-only preflight immediately before rollout; compare ledger,
   source hashes, pinned methodology, plans, queues and active leases. The V2.4
   snapshot is not a substitute for a fresh rollout-time check.
3. Verify a fresh production backup and a usable restoration procedure at that
   time. Record backup reference, timestamp, retention and recovery owner. No
   backup is claimed to exist merely because this runbook requires one.
4. Use an approved maintenance/write pause for signup, company/profile changes,
   answer saves/submissions and report/email requests. Keep read access available
   where the deployed artifact and maintenance mechanism allow it. Do not invent
   an application maintenance flag; verify the actual Render/proxy mechanism.
5. Drain existing scoring, AI, PDF/email and consultation jobs. Inspect all live
   leases, not only queue totals. Unexplained active work or uncertain provider
   calls means STOP. Capture protected row hashes and relevant schema catalogs
   under the write pause.

## Migration packages and read-only commands

Prepare separate, hashed, CLI-compatible packages for Phase A, Phase B and the
remaining migration tail using the exact production ledger. Applied historical
files remain byte-identical. Known staging timestamp aliases must not be assumed
to be production aliases. A copied package may represent a proven remote alias;
never rename repository history, repair a ledger, or change migration statements.

The methodology migration `20260918000100` was already reconciled. Its SQL must
never appear as pending and must never be replayed. Never use `--include-all`,
`migration repair`, ledger INSERT/UPDATE, `--include-roles`, or seed operations.

Read-only validation, using the pinned repository CLI and a reviewed package:

```sh
./node_modules/.bin/supabase --agent no --output pretty db push \
  --project-ref fhvxqeaujjeiflanqsbg --dry-run --skip-vault \
  --workdir ../artifacts/v24-production-readiness/production-release
```

The exact output must match `production-dry-run.json`. A full pending list is
inventory, not authorization for a one-shot push. For each future phase repeat
this command with that phase's separately reviewed package and require its exact
allow-list. A future approved apply removes only `--dry-run` and adds `--yes`;
it retains the explicit project, package and `--skip-vault`. Do not execute applies
as part of V2.4.

## Ordered future rollout

1. **V1 → Phase A expansion.** Under write pause apply only account foundation.
   Preserve V1 ownership policies and uniqueness. Compare protected IDs/hashes,
   check one immutable legacy Account mapping and one active owner per user,
   zero orphan companies, unchanged history/methodology and V1 read/save/submit
   behavior. The old V1 worker may remain only while its exact queue contract has
   passed the isolated compatibility rehearsal and the queue remains drained.
2. **Deploy the compatible application.** Explicitly pin web to
   `15f36e6ab1ed5229618b34fa3270eca2c47da5ea`, never stale main. Verify health,
   known-user login, first-company/profile paths, pinned historical diagnostic,
   save/submit and existing result/report/PDF. No account transfer, owner
   revocation, archival, additional companies or commercial changes in this
   compatibility interval. Retain the original V1 artifact for pre-cutover
   containment. Do not proceed if the accepted compatible artifact cannot be
   rebuilt or its actual Phase A contract fails.
3. **Drain and pause the old worker before cutover.** Verify no live leases or
   pending work; stop/pause the service through the separately approved operator
   action. Do not alter jobs to make a drain appear successful. Keep write pause.
4. **Phase B authorization cutover.** Apply only the reviewed cutover package.
   Check validated/non-null Account mapping, replacement owner policies,
   foreign-Account denial and historical integrity. This is the forward-only
   authorization boundary: a general return to original V1 is no longer assumed
   safe. Keep the tested compatible web artifact during the short migration tail.
5. **Later V2 migration tail.** Apply the exact dependency-ordered list from
   `production-rollout-plan.json`, not an ad hoc selection: Team foundation,
   aggregation/reporting, participant passwordless, single-email consent,
   Plans/Entitlements, rich Team reports, bounded synthesis repair, Team V3/PDF,
   and the V2.4 admin/audit/security migration. Recheck the exact pending list and
   data/invariants at each approved package boundary. A migration error or
   uncertain result means STOP and inspect the ledger; do not retry blindly.
6. **Deploy final web.** All required tables, functions and migrations must be
   present before final V2.4 web starts. Deploy the exact manifest SHA explicitly:

   ```sh
   render deploys create srv-dak57did0e5s73b1t0b0 \
     --commit "$V24_APPROVED_SHA" --confirm --output json
   ```

   `V24_APPROVED_SHA` must be set by the future operator from the accepted
   manifest and checked against the approved release; it is not a shell default.
   Require Live, correct commit, health and normal Free owner regression.
7. **Deploy final worker.** After final schema and web postflight, explicitly
   deploy the same SHA to `srv-dak5rurl550s73a17l60`. Verify startup, all individual,
   consultation and Team claim contracts, safe provider configuration and clean
   leases before resuming writes. Never run final worker against V1/partial V2
   schema and never restore old worker across an unproven schema boundary.
8. **Reopen only the accepted scope.** Verify all backfilled/new existing Accounts
   default to Free, with no automatic Advanced promotion. Additional existing
   resources and historical reports/PDF remain readable after downgrade. New
   expansion is denied. Existing V1 individual functionality remains available.
   Run only separately approved smoke jobs, with explicit mock/real provider and
   email bounds; V2.4 itself sends no AI or email requests.

## Commercial and Team launch gates

Schema presence, application deployment, plan assignment and launch approval are
separate decisions. New Accounts receive Free from the DB default. Do not invoke
either plan-assignment RPC to promote production Accounts during migration.
Free denies new additional companies, Team diagnostics and participants.

There is no independent global Team launch switch in the accepted runtime.
The current enforceable gate is server/DB-derived `team_diagnostics` entitlement.
Keep every production Account Free, and hold all manual Advanced assignments
until a separate Team/commercial launch approval. Do not claim an imaginary env
flag disables Team. If Advanced must launch while Team remains disabled, STOP
and implement/approve a separate tested gate before that launch; changing plan
entitlement definitions directly is not part of this runbook.

Already invited participants may continue after downgrade; that preservation rule
is intentional, not a global emergency stop. Any future emergency participant
restriction requires its own reviewed containment action and authorization.

## Postflight and rollback/containment

- Compare old row IDs/hashes and schema/ledger with the fresh preflight, separately
  classifying only authorized smoke additions, backfill and audit metadata.
- Verify methodology reconciliation was preserved, not replayed; verify Free
  defaults, one active subscription, admin/user authorization separation and
  denied raw Team data access. Legal versions must be approved and immutable
  historical consent rows must remain unchanged.
- Verify both actual deploy SHAs match the final manifest; auto-deploy stays off.
- **Before Phase B:** stop new writes/jobs, keep Phase A data, and roll the web
  back to retained V1 only where the rehearsed compatibility matrix allows it.
- **After Phase B:** keep maintenance/write pause, stop mismatched workers and
  use only a tested compatible or final application against that exact schema.
  Prefer a reviewed forward fix. Do not promise V1 rollback or destructive down
  migrations, remove Accounts, drop V2 tables, undo consent, or erase audit rows.
- A provider issue requires stopping new approved external work, not resetting
  jobs or leases. Preserve completed outputs/history and inspect idempotency.
- Backup restoration is a separate recovery decision with write-loss analysis,
  verified backup, project/traffic plan and explicit permission. It is not an
  automatic rollback command.

Any unexpected migration, wrong project/service, missing backup, failed drain,
broken compatible-app smoke, foreign-Account access, uncaught privacy exposure,
duplicate active plans, changed protected data, unknown migration outcome or
worker/schema mismatch means **STOP**. Keep production unchanged during V2.4.
