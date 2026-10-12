# V2.1A exact rollout file manifests

Base reconciliation: `0996971bfeac4ab50136998307169f6c63be8f44`.
Preserved implementation snapshot: `15f4159cc4ee52e93ab440f5eea51e076bbb286d`.
Rollout branch: `codex/v21a-account-foundation-rollout`.

Each list is the exact diff from that commit's parent. All 30 existing migration blobs are unchanged; runtime source and both account SQL files match the implementation snapshot. The final tree has seven documentation/test exceptions listed below.

## Commit 1 — database expansion

Reference: `c892fc8ea4bf61a4f96959169972b63dbfe01ca0`.

4 files:

- `docs/runbooks/v21a-account-phase-a.md`
- `scripts/test-account-phase-a-local.py`
- `supabase/migrations/20261013000100_account_foundation.sql`
- `supabase/tests/fixtures/account-foundation-local-history.sql`

## Commit 2 — compatible application

Reference: `15f36e6ab1ed5229618b34fa3270eca2c47da5ea`.

53 files:

- `docs/architecture/v21a-compatible-application.md`
- `docs/runbooks/cleanup-test-data-safety.md`
- `scripts/cleanup-production-test-data.sql`
- `src/app/[locale]/(admin)/admin/companies/[companyId]/page.tsx`
- `src/app/[locale]/(admin)/admin/companies/page.tsx`
- `src/app/[locale]/(admin)/admin/users/[userId]/page.tsx`
- `src/app/[locale]/(admin)/admin/users/page.tsx`
- `src/app/[locale]/(workspace)/company-profile/page.tsx`
- `src/app/[locale]/(workspace)/dashboard/page.tsx`
- `src/app/[locale]/accounts/[accountId]/companies/page.tsx`
- `src/app/[locale]/companies/[companyId]/diagnostics/page.tsx`
- `src/app/[locale]/companies/[companyId]/page.tsx`
- `src/app/[locale]/companies/[companyId]/profile/page.tsx`
- `src/app/[locale]/companies/page.tsx`
- `src/app/api/diagnostics/[diagnosticId]/ai/route.ts`
- `src/app/api/diagnostics/[diagnosticId]/reports/route.ts`
- `src/app/api/diagnostics/[diagnosticId]/score/route.ts`
- `src/app/api/diagnostics/route.ts`
- `src/features/company/company-dashboard.tsx`
- `src/features/company/company-list.tsx`
- `src/features/company/company-profile-editor.tsx`
- `src/features/company/company-profile-form.tsx`
- `src/features/company/company-route.ts`
- `src/features/company/workspace-routing.ts`
- `src/server/account/authorization.ts`
- `src/server/account/queries.ts`
- `src/server/admin/companies-users.ts`
- `src/server/ai/regeneration.ts`
- `src/server/ai/worker.ts`
- `src/server/auth/session.ts`
- `src/server/company/actions.ts`
- `src/server/company/queries.ts`
- `src/server/diagnostic/actions.ts`
- `src/server/diagnostic/result.ts`
- `src/server/diagnostic/service.ts`
- `src/server/email/service.ts`
- `src/server/feedback/service.ts`
- `src/server/pdf/service.ts`
- `src/types/database.generated.ts`
- `tests/admin/account-companies-ui.test.ts`
- `tests/admin/companies-users.test.ts`
- `tests/ai/report-regeneration.test.ts`
- `tests/auth/account-destination.test.ts`
- `tests/company/account-authorization.test.ts`
- `tests/company/company-route.test.ts`
- `tests/company/profile-validation-preservation.test.ts`
- `tests/company/workspace-pages.test.ts`
- `tests/company/workspace-routing.test.ts`
- `tests/diagnostic/dashboard-active-ux.test.ts`
- `tests/diagnostic/start-diagnostic.test.ts`
- `tests/email/email.test.ts`
- `tests/scoring/ownership.test.ts`
- `tests/security/cleanup-execute-guard.test.ts`

## Commit 3 — authorization cutover

Reference: `Exact SHA supplied in the release report; the final rollout tip`.

7 files:

- `docs/architecture/v2-account-foundation-files.md`
- `docs/architecture/v2-account-foundation.md`
- `docs/runbooks/v21a-account-foundation-staging.md`
- `scripts/test-account-foundation-local.py`
- `scripts/test-account-rollout-local.py`
- `supabase/migrations/20261013000200_account_authorization_cutover.sql`
- `tests/security/account-migration-boundaries.test.ts`

## Final tree equivalence exceptions

Relative to the implementation snapshot, only these rollout documentation and test-partition files differ:

- `docs/architecture/v2-account-foundation-files.md`
- `docs/architecture/v2-account-foundation.md`
- `docs/architecture/v21a-compatible-application.md`
- `docs/runbooks/v21a-account-foundation-staging.md`
- `docs/runbooks/v21a-account-phase-a.md`
- `scripts/test-account-phase-a-local.py`
- `scripts/test-account-rollout-local.py`

The full-cutover runner, its fixtures and scope tests retain their original contents. The independent expansion runner can execute before the cutover file exists. The rollout checker verifies exact commit partitions, ancestry, hashes, tree exceptions and real local CLI pending lists `[A] → [] → [B]`. No application behavior or migration SQL was rewritten.

See [the staging runbook](../runbooks/v21a-account-foundation-staging.md) for the mandatory application-deployment and real staging validation checkpoint.
