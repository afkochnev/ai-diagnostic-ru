# V2.1A compatible application checkpoint

This application tree is copied byte-for-byte from implementation snapshot
`15f4159cc4ee52e93ab440f5eea51e076bbb286d`; its cutover migration and full-cutover
tests are deliberately deferred to the third rollout commit. This checkpoint has
no `20261013000200_account_authorization_cutover.sql` file.

## Dual schema compatibility

Phase A supplies all new account tables, account/company/diagnostic helpers and
the company account column used by the application. Existing public save/submit/
lead/feedback RPC signatures remain valid before and after cutover. Application
authorization binds verified cookie identity to active owner membership and company
context, then the database enforces whichever checkpoint's RLS is present.

Before cutover, all existing company/diagnostic creators match the backfilled owner.
Their original RLS therefore continues to allow every valid account-aware query.
The company account column is catalog-nullable, but actual NULL values are forbidden
by the acceptance gate: backfill verifies attachment, INSERT always assigns/validates
an account and UPDATE cannot clear an existing attachment. The final generated Row
type consequently represents both checkpoints' actual company rows.

After Phase B, the same application runs with membership RLS, a validated NOT NULL
FK and multiple company records per account. No Phase B-only relation, RPC signature
or new product capability is needed for application deployment. Populated accounts
have no additional-company creation control. Global administrator authority remains
separate from owner membership and protected by existing admin/MFA checks.

## Deployment gate

With Phase A already recorded in staging, this tree's Supabase dry-run must report
no pending migrations. Deploy and verify this exact artifact against the real Phase
A schema before checking out the third commit for a migration apply. Local tests
and a successful build do not replace the running-artifact staging gate.

Between A and B, do not transfer/revoke/archive owners/accounts, remap companies,
create extra companies or run creator-allowlist cleanup. Legacy database authority
intentionally remains creator-based; the server additionally checks membership.
Leave mappings unchanged so both authorities agree throughout this window.

The independent Phase A runner exercises account-filtered listing and explicit
account/id/revision profile writes under unchanged V1 policies. The application
suite exercises server/session authorization, explicit routes, V1 selection,
diagnostics, report/PDF/email/AI access and plural admin projections. Validate this
checkpoint with lint, typecheck, unit tests and production build using safe mock
provider configuration. Real Supabase Auth/PostgREST rehearsal remains required.

If application recovery is needed before cutover, the Phase A schema supports the
retained V1 artifact. After cutover, recover using this compatible artifact or a
reviewed forward fix while retaining all data and both recorded account migrations.
The third checkpoint provides the full release manifests and staging runbook.
