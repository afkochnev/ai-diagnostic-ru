# V2.7 production rollout reconstruction — BLOCKED

This is an audited preparation document, not permission to execute production
commands. **STOP: production mutations remain unauthorized.** Commercial checkout versioning
and verified full refunds are implemented in the continuation candidate. Final
privacy documents, production payment support and final staging acceptance remain
separate gates. The historical baseline below is retained for provenance only.
The commands below describe the exact audited candidate, not an approved launch.
Any runtime correction requires a new manifest, CI and affected staging acceptance.
No production write, email, AI request or payment was executed during V2.7.

## Owner-authorized continuation, 22 October 2026

The owner approved commercial version `advanced-terms-ru-v1` and full 480 RUB
refunds requested at `info@iteam.ru`. The owner subsequently supplied the complete
approved offer and merchant requisites. The exact versioned source is
`docs/legal/advanced-terms-ru-v1.md`; only the publication-date placeholder is
filled as 22 October 2026. Its SHA-256 is
`5e98f8712abd03413598efced5f1e1445701af873e552e32d9797c495191fe94`.
The approved legal address is 123100, Moscow, Presnenskaya naberezhnaya 12,
office 10/45; no address from another public document is substituted.
Publication is additive and rejects any conflicting document under the same
version. Checkout remains closed wherever the approved immutable document is absent.

The continuation branch implements commercial version/hash acceptance, full-refund
verification and independent launch controls. These are LOCAL changes, not the
canonical deployed RC in the table below. The three new migration versions are
`20261022130314`, `20261022131400` and `20261022133523`; the production pending
inventory is therefore 17, not the historical 14 below. Publication acceptance
and exact read-only receipts are in
`artifacts/v27-production-launch/approved-offer-staging/`. The earlier
blocked runbook is archived there as `runbook-initial-stop.md`.

Operational control semantics after future acceptance:

- `BILLING_ENABLED=false` denies new checkout; verified reconciliation continues
  with the same exact TEST environment/merchant guards.
- `YOOKASSA_RECONCILIATION_ENABLED=false` is a separate provider-incident stop.
- `YOOKASSA_REFUNDS_ENABLED=false` is the default; no refund POST is permitted.
  `YOOKASSA_REFUND_RECEIPT_MODE=from_original_payment` additionally requires
  confirmed merchant receipt behavior before any permitted refund initiation.
- `ACQUISITION_ENABLED` and `TEAM_ENABLED` require explicit `true` on the exact
  production origin/project pair; production is still unchanged and OFF.
- Creation stops `ACQUISITION_START_ENABLED=false`, `TEAM_CREATION_ENABLED=false`
  and `TEAM_INVITATIONS_ENABLED=false` do not disable existing sessions, Team
  reads/answers or worker processing. Independent `private.launch_controls` DB
  flags also default false and prevent direct creation-RPC bypass.
- The ordinary Team worker now uses the same production enable boundary as web.
  Its source changed; the old worker equivalence proof no longer approves it for
  this continuation. A new worker artifact/compatibility manifest is required.
- A successful full refund is proved using authenticated refund GET plus the
  original payment GET (merchant/test/amount/metadata and total refunded amount).
  Only then does a service-only atomic transaction end Advanced and create Free.
  Historical reports/diagnostics/data and original commercial evidence are retained.
  Pending/canceled refunds do not change access; duplicate old refunds cannot
  revoke a later purchase. Persist the POST refund ID before verification so
  recovery uses GET, not a new refund.

Because the payment path changed, the old V26B TEST payment is supporting history,
not acceptance of this new candidate. Prepare a separately bounded staging TEST
plan after the approved document is supplied. No provider payment/refund, real
email, AI request, staging migration/deploy or production mutation was executed
by this local continuation. Full canonical staging regression, approved final
privacy versions, Auth/fiscal configuration and all production approvals remain
open gates. **Do not execute the historical commands below for the new candidate.**

## Pinned scope — historical audited baseline

| Object | Exact identity |
| --- | --- |
| Production origin | `https://audit.iteam.ru` |
| Production Supabase | `fhvxqeaujjeiflanqsbg` |
| Production web | `srv-dak57did0e5s73b1t0b0` |
| Production worker | `srv-dak5rurl550s73a17l60` |
| Current production web and worker | `0b8c4acb6a1071e5be06268ba8216c4215036e84` |
| Intermediate Account-compatible web | `15f36e6ab1ed5229618b34fa3270eca2c47da5ea` |
| Canonical audited web RC | `7bb206fbf408f25408859403e20e775d8ec3e6c1` |
| Retained accepted compatible worker | `5bd9965421aadf04503fa4fa8489ca0fe474e3cd` |
| RC tree | `1a21950d505b34b36503b617c84592e6b840b8ec` |
| Tools | Node `26.8.1`, Supabase CLI `2.117.0`, Render CLI `2.28.0` |

All commands assume the repository directory
`/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/ai-diagnostic-v22a-team-foundation`.
Evidence is in its sibling `artifacts/v27-production-launch/` directory.
Auto-deploy and previews must remain OFF on both production services.
The owner approved PR7 merge and canonical staging only. That approval is exhausted
by those actions and does not authorize anything in this production runbook.

## Evidence and limits

Canonical CI run `39773625622` passed lint, typecheck, build, 914 unit tests
(8 existing optional skips), full isolated SQL and Linux Docker build. Canonical
staging web is Live at the RC. The retained worker has byte-identical transitive
runtime sources/dependencies; it was not redeployed for SHA symmetry.

Production has 30 ledger entries and 8,365 protected rows across 38 tables.
Staging has 44 entries and 7,523 protected rows across 73 tables. Before/after
fingerprints, schema metadata and ledgers match. These are dated observations,
not future expected counts. No raw answers were exported.

The network-isolated PostgreSQL rehearsal applied exact historical SQL to synthetic
history, checked Account ownership/Free defaults and actual exported application
services at V1, A, B, Team, billing, V26A and final states. Identity verification
and PostgREST transport were mocked; SQL/RLS were real. Worker claim RPC contracts
were checked on empty queues. No live GoTrue or external worker invocation is
claimed. The final plan service fails on V1/A/B/Team; intermediate-state service
PASS at billing does not certify all final pages/Admin RPCs. Keep the intermediate
web until the entire 44-entry ledger exists.

## Unclosed gates — do not start rollout

1. Obtain approved final privacy/processing, marketing and commercial/access/
   refund/receipt documents and exact immutable versions. `temporary-ru-v1`
   remains current. Do not author legal wording or rewrite historical consents.
2. Implement required commercial links and a fail-closed server checkout version
   check. The current plan page only checks billing/provider/receipt readiness.
3. Review production feature controls. `ACQUISITION_ENABLED` and `TEAM_ENABLED`
   are not implemented switches. Exact staging origin/project guards currently
   make these features entirely OFF in production. Do not spoof staging origins.
4. The current YooKassa adapter is intentionally TEST-only. Production payment
   support requires a reviewed correction enforcing `test=false` in production
   and `test=true` in staging. Never merely remove validation or reuse TEST keys.
5. Complete fresh canonical staging mock flows: anonymous start/claim, Individual
   report/PDF, Team create/invite/aggregate/report/PDF, Admin and Funnel. These
   were not executed after the mandatory stop finding. Earlier acceptance and
   current CI support the audit but do not equal this fresh full live regression.
6. Before enabling new Auth flows, approve exact production callback paths:
   `/auth/confirm`, recovery query behavior, `/ru/free/confirm`, `/ru/team/join`,
   `/ru/team/confirm`. Current allowlist contains only `/auth/confirm`.
   Enable leaked-password protection through a separately authorized Auth change.
7. Add actionable receipt failure/pending-age health coverage. Current Admin
   Billing displays per-payment receipt state; aggregate receipt health is absent.
8. Confirm retention obligations; seven-day anonymous expiry does not delete data.

After corrections, regenerate the RC/manifest/runbook hashes. A material payment
path correction requires new staging sandbox acceptance. While the exact accepted
payment tree remains unchanged, reuse V26B TEST evidence; do not create another
payment solely for this preparation phase.

## Future preflight, backup and maintenance gates

Obtain explicit production authorization naming the regenerated manifest/runbook
hashes, exact service SHAs, project, migration set, feature scope, initial billing
OFF and bounded smoke operations. A generic “continue” is insufficient.

Immediately before the first mutation, repeat safe baseline, ledger, methodology,
service/auto-deploy, queues/leases and exact dry-run. Inspect pending/failed
retryable scoring, AI, consultation, email and Team work, not just total row counts.
Never delete jobs or release leases to manufacture an empty queue. Uncertain
external requests, active/unknown leases or unexpected data changes mean STOP.

The managed backup API currently lists completed physical daily backups; latest
observed reference `2035111730`, `2026-10-22T04:58:51.763Z`. PITR is OFF. This is
backup capability evidence, not a freshly created rollout backup or restore test.
Future release operator must record a fresh immediately-pre-mutation backup,
recovery owner, scope, timestamp, retention and tested restoration procedure.
If only an older managed backup is available, do not waive the freshness gate.

A separately authorized private logical backup can be prepared with the pinned
CLI, without printing data or passwords. The following are future backup-only
commands; do not run them during this read-only preparation:

```sh
umask 077
mkdir -m 700 /private/tmp/aca-v27-production-backup
./node_modules/.bin/supabase --agent no db dump --project-ref fhvxqeaujjeiflanqsbg --schema public,private,auth,storage --file /private/tmp/aca-v27-production-backup/schema.sql
./node_modules/.bin/supabase --agent no db dump --project-ref fhvxqeaujjeiflanqsbg --schema public,private,auth,storage --data-only --use-copy --file /private/tmp/aca-v27-production-backup/data.sql
./node_modules/.bin/supabase --agent no db dump --project-ref fhvxqeaujjeiflanqsbg --role-only --file /private/tmp/aca-v27-production-backup/roles.sql
```

Use a new empty private directory; failure or an existing backup directory means
STOP, not overwrite. Authenticate privately; never put a DB password in command
arguments/chat. This export may contain personal data and role material; keep it
outside evidence/Git and under approved encrypted retention. Do not claim it is
restorable until the release operator verifies a supported restoration process,
including Supabase-managed auth/storage constraints. Storage object bytes, service
secrets and provider settings need separate protected recovery coverage. Recovery
is a separately approved decision with write-loss assessment, never an automatic
rollback after a failed migration.

Future authorized maintenance action (whole web surface, not a global DB fence):

```sh
render services update srv-dak57did0e5s73b1t0b0 --maintenance-mode=true --confirm --output json
```

Verify readback and quiet direct Auth/API traffic as well. Inspect transactions
and lock waits. Phase A locks Auth/users/provisioning and Phase B locks
companies/diagnostics transactionally; web maintenance alone cannot stop direct
Supabase clients. If a safe quiet window cannot be established, STOP/reschedule.
Keep legacy report/PDF read access where maintenance mechanism permits it;
do not invent a global write-pause flag or silently change Auth/RLS.

## Exact migration packages

`production-phase-packages.json` pins all SQL bytes and package hashes. Never use
`--include-all`, migration/ledger repair, reset, seed, or ad hoc schema push.
`20260918000100` is already ledger-reconciled and must NEVER appear as pending.
Known staging timestamp alias `20261016181419` does not replace production's
repository version `20261016175038`.

The full inventory dry-run already passed with exactly these 14 pending files:

1. `20261013000100_account_foundation.sql`
2. `20261013000200_account_authorization_cutover.sql`
3. `20261015135524_team_diagnostic_foundation.sql`
4. `20261015170255_team_aggregation_report.sql`
5. `20261016075550_team_participant_passwordless.sql`
6. `20261016175038_team_single_email_consent.sql`
7. `20261018071921_plans_entitlements_billing_foundation.sql`
8. `20261018105321_rich_team_ai_report_v2.sql`
9. `20261018171308_team_synthesis_bounded_repair.sql`
10. `20261019073437_team_report_v3_and_pdf.sql`
11. `20261020170720_v24_admin_console_and_plan_audit.sql`
12. `20261020191130_anonymous_free_diagnostic_funnel.sql`
13. `20261021132005_billing_commercial_activation.sql`
14. `20261021164251_yookassa_annual_billing.sql`

Read-only inventory command:

```sh
./node_modules/.bin/supabase --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --dry-run --skip-vault --workdir ../artifacts/v27-production-launch/production-release
```

**Never apply `production-release` as a one-shot cutover.** The future sequence is:

### A. Expand Account foundation while still compatible with V1

Require exactly the original 30-entry ledger and only Phase A pending:

```sh
./node_modules/.bin/supabase --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --dry-run --skip-vault --workdir ../artifacts/v27-production-launch/production-phase-a
```

Only under future explicit rollout approval and all gates PASS:

```sh
./node_modules/.bin/supabase --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --yes --skip-vault --workdir ../artifacts/v27-production-launch/production-phase-a
render deploys create srv-dak57did0e5s73b1t0b0 --commit 15f36e6ab1ed5229618b34fa3270eca2c47da5ea --wait --confirm --output json
```

Require ledger31, Live exact intermediate web, one correct legacy Account per
owner, active membership, no orphan Company, unchanged historical identifiers/
methodology, foreign-owner denial and reachable existing diagnostic/report/PDF.
Do not create a second Company, transfer/revoke ownership or grant Advanced here.
Old worker may remain only through the drained, tested V1/A contract.

### B. Stop old worker, then authorization cutover

Drain/inspect leases again. Open
`https://dashboard.render.com/worker/srv-dak5rurl550s73a17l60`, suspend only this
worker and verify suspended state and zero leases after graceful termination.
Keep web write pause. Do not leave old workers running across this boundary.

Require ledger31 and only Phase B pending:

```sh
./node_modules/.bin/supabase --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --dry-run --skip-vault --workdir ../artifacts/v27-production-launch/production-phase-b
```

Future approved apply only:

```sh
./node_modules/.bin/supabase --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --yes --skip-vault --workdir ../artifacts/v27-production-launch/production-phase-b
```

Require ledger32, validated Account mappings, correct RLS ownership and historical
reachability. **This is the boundary after which a general original-V1 rollback
is not safe.** The old singular Company contract fails once multiple Companies
are allowed; do not promise a V1 rollback based on a single unchanged Company.

### C. Remaining twelve files while intermediate web remains selected

Require ledger32; pending list must be files3–14 above in exact order:

```sh
./node_modules/.bin/supabase --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --dry-run --skip-vault --workdir ../artifacts/v27-production-launch/production-tail
```

Future approved apply only:

```sh
./node_modules/.bin/supabase --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --yes --skip-vault --workdir ../artifacts/v27-production-launch/production-tail
```

Require ledger44 and exact statement/source hashes, preserved old rows and
methodology, all existing Accounts Free, no automatic Advanced, no old report
paywall. A partial failure means inspect committed ledger and STOP; no blind retry,
ledger repair or down migration. Worker stays stopped until schema is complete.

### D. Core web and retained compatible worker; features remain OFF

The following candidate commands remain BLOCKED until the recorded RC is
superseded/accepted with all release gates closed. Do not substitute branch names.

```sh
render deploys create srv-dak57did0e5s73b1t0b0 --commit 7bb206fbf408f25408859403e20e775d8ec3e6c1 --wait --confirm --output json
render deploys create srv-dak5rurl550s73a17l60 --commit 5bd9965421aadf04503fa4fa8489ca0fe474e3cd --wait --confirm --output json
```

Select/resume only the specified suspended worker in its Render Dashboard and
verify actual selected commit/startup/leases. Do not assume deploying a suspended
service resumes it. Do not deploy final code against a partial ledger.
Set explicit `BILLING_ENABLED=false` under the future approved config action.
Current origin guards keep anonymous/Team OFF; there is no usable production
`ACQUISITION_ENABLED`/`TEAM_ENABLED` toggle in this candidate.

Future approved health check correction:

```sh
render services update srv-dak57did0e5s73b1t0b0 --health-check-path /api/health --confirm --output json
```

Verify health, login, an existing Company/Individual diagnostic, existing report
and PDF, Free defaults, foreign-Account denial, Admin boundary and billing-disabled
UI. New report/AI/email smoke jobs require explicit provider bounds; do not invoke
production's currently configured real providers as an implicit read-only test.

After successful approved postflight:

```sh
render services update srv-dak57did0e5s73b1t0b0 --maintenance-mode=false --confirm --output json
```

Keep auto-deploy OFF and record exact web/worker Live commits, queue state and
protected-data comparison with expected backfill/smoke additions classified.

## Separate feature and real billing stages — currently blocked

Stage2 may enable acquisition/Team only after reviewed production enable/kill
controls, final consent/callback tests and separate explicit scope approval.
Anonymous start OFF must preserve claimed users; Team creation/invite OFF must
preserve existing Team reads/data/entitlements. There is no existing safe toggle
to copy into this runbook; implement/test it before permitting activation.

Billing is LAST. Approved commercial contract is 480.00 RUB, one calendar year,
vat_code=1/no VAT, service/full_payment, no recurring charge or automatic renewal.
Display `480 ₽`, optionally `Без НДС`; do not calculate/display a VAT amount.
Do not infer USN subtype. Send tax_system_code only when the confirmed production
receipt solution requires it; otherwise omit. Confirm full_payment against the
actual production merchant/fiscal setup; the accepted TEST simulator is not proof.

Only under separate approval install protected production-shop credentials in
production web, never TEST credentials. Configure the production merchant's two
events `payment.succeeded` and `payment.canceled` to the **implemented** route:

`https://audit.iteam.ru/api/billing/webhook/yookassa`

The conceptual `/api/billing/yookassa/webhook` in the task is reversed and has no
handler. Do not set it in the merchant dashboard. No production merchant settings
were read or changed here; existing iTeam integrations must not be overwritten.

A future real-money smoke needs separate approval for exact count/cost/account,
server-verified `test=false`, paid/succeeded, exact receipt item and registration
success, single annual activation and duplicate replay safety. Current adapter
rejects production entirely; merely flipping env is insufficient and forbidden.

## Containment

Before PhaseB, retain verified V1/A scope and compatible intermediate web. After
PhaseB, keep maintenance, stop incompatible workers and use only verified
intermediate/final artifacts for that schema; prefer reviewed forward correction.
Do not erase Accounts, consent/audit rows or provider events, repair ledgers, or
promise destructive rollback. Backup restore requires a separate recovery decision.

`BILLING_ENABLED=false` blocks new checkout and leaves subscription-derived paid
access intact. In current code it also disables YooKassa webhook handling. Preserve
unreconciled provider payments and later verify them server-to-server before
idempotent processing; never infer payment from browser return or webhook body.
Provider HTTP subscriptions may be disabled only by the authorized production
merchant operator; later reconcile missed notifications. Do not revoke paid plans.

Acquisition/Team emergency controls are unimplemented for production and are a
launch blocker, not an operator instruction to invent flags. Stop new work while
preserving claimed users, historical reports, paid access and Team data.

## Exit and authorization

Current status: `V27_BLOCKED_RELEASE_GATES`, not `PRODUCTION_READY` and not
`V27_TECHNICAL_LAUNCH_PACKAGE_READY_BLOCKED_LEGAL`. Technical controls and full
canonical regression are incomplete in addition to final legal documents.
Use `release-blockers.json`, final checklist and final readiness report to close
them. Only after closure regenerate exact hashes and ask the owner for production
authorization naming that regenerated runbook/manifest, migrations and service
SHAs with billing initially OFF. No production approval is requested now.
