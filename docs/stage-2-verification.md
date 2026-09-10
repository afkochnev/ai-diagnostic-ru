# Stage 2 Verification

Completed for the authorized Stage 2 scope. Stage 3 has not been implemented.

## Implemented

- Supabase Auth with SSR cookies, proxy session refresh, protected route checks and server actions.
- Registration with Russian fields, eight-character password minimum and separate required/optional consent checkboxes.
- Mandatory email confirmation before protected application access.
- Login, generic incorrect-credential errors, logout, forgotten-password request, expiring one-use reset link and password update.
- `users`, `user_roles`, `consent_documents`, `user_consents` and restricted `private.audit_events` migration.
- Database trigger always provisions `user`; signup metadata cannot assign `administrator`.
- Basic RLS, immutable consent history, owner-only user profile reads/updates and administrator read path requiring `aal2`.
- MFA TOTP enrollment/verification surface for administrator role. No admin UI was created.
- Configurable temporary legal-document URLs and Russian placeholder legal pages; final legal texts are not invented.
- Protected handoff pages only for future company profile, Dashboard and admin routes. No Company Profile or Dashboard functionality exists yet.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with zero warnings |
| `npm run build` | Passed with Webpack |
| `npx supabase db reset` | Passed; Stage 2 migration applied |
| `npx supabase test db` | Passed: 15 RLS/identity tests |
| `npx playwright test tests/e2e/auth.spec.ts --project=identity` | Passed: 2 tests |
| `npx playwright test tests/e2e/landing.spec.ts` | Passed: 6 tests |
| Full `npx playwright test` | Passed after production-server restart: 8 tests |

The identity E2E covers registration, missing mandatory consent, verification-required login, confirmation email, protected handoff, access denial, logout, incorrect password, password recovery, one-use recovery link and attempted administrator escalation through metadata and public API. Local Mailpit captures Supabase emails; no external email is sent.

## Environment

Copy `.env.example` to `.env.local` for local work. Required variables are `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_URL` and a random server-only `AUTH_FLOW_SECRET` of at least 32 characters. `DATA_PROCESSING_POLICY_URL` and `MARKETING_POLICY_URL` are optional replacements for the temporary local legal pages. Obtain URL and publishable key from the Supabase project Connect/API settings; never use or expose the service-role key in this application.

Local Supabase is configured in `supabase/config.toml`: email confirmations, eight-character passwords, secure password changes, refresh-token rotation, TOTP support and Mailpit. The local Mailpit UI is `http://127.0.0.1:54324`; the Supabase API is `http://127.0.0.1:54321`.

## Release blocker retained

Approved legal texts and versions, jurisdiction/hosting requirements, retention and erasure across Auth/database/storage/providers, marketing-data lifecycle and any justified IP/analytics consent remain release blockers in `OPEN_DECISIONS.md`. They do not block this Stage 2 implementation or synthetic local tests.
