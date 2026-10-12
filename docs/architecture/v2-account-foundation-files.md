# V2.1A file manifest

59 changed or added files relative to `0996971bfeac4ab50136998307169f6c63be8f44`.

Existing methodology migrations are unchanged. The two account migrations are new files; all historical methodology SQL remains byte-identical to the base commit.

## Migrations and PostgreSQL tests

- `scripts/test-account-foundation-local.py`
- `supabase/migrations/20261013000100_account_foundation.sql`
- `supabase/migrations/20261013000200_account_authorization_cutover.sql`
- `supabase/tests/fixtures/account-foundation-local-history.sql`

## Server, authorization and database types

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

## Application routes and company UI

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

## Application tests

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
- `tests/security/account-migration-boundaries.test.ts`
- `tests/security/cleanup-execute-guard.test.ts`

## Operations and documentation

- `docs/architecture/v2-account-foundation-files.md`
- `docs/architecture/v2-account-foundation.md`
- `docs/runbooks/cleanup-test-data-safety.md`
- `scripts/cleanup-production-test-data.sql`
