# Stage 10 — Final Production Readiness

## Scope and evidence

Stages 7A–7D, 8A–8G and 9A–9E are accepted. The selected runtime is a Render Docker Web Service plus a separate Render Background Worker and hosted Supabase. The repository contains the accepted Docker/Chromium runtime, RU-1.3 prompt asset, read-only PDF GET contract, worker lifecycle hardening, shared rate limits, safe health endpoint, and operational SQL. This audit is read-only; no provider calls or production data changes were made.

## Architecture and security result

The authenticated journey and remote staging flows have passed through account, company profile, diagnostic blocks, deterministic scoring, mock worker jobs, report display, PDF preparation/download, email/consultation/feedback paths, report regeneration, and resume semantics. Admin access retains role plus verified email and MFA/AAL2 requirements. Canonical ownership is user → company → diagnostic → report → artifact/lead/feedback; service-role access is server-side after authorization. RLS and SECURITY DEFINER functions are migration-controlled with restricted grants and explicit search paths.

Scoring remains deterministic and immutable after completion. AI reports use the RU-1.3 hardened prompt, an explicit untrusted diagnostic-data envelope, schema validation and output injection checks. Numeric scores come from persisted results. Completed-report selection follows D13: a generating or failed newer version does not hide the highest completed version. Web requests enqueue work; the worker claims jobs atomically with leases, retries transient failures, terminalizes poison jobs and stops cleanly on SIGTERM.

PDF download is read-only and serves only an existing READY artifact bound to the requested report/version/template. Preparation is an authenticated mutation with artifact reuse and deduplication. Email and consultation paths preserve exact report ownership and version binding, with server-side provider adapters and rate limits. `/api/health` is static liveness; no separate readiness endpoint is required for the current Render model.

## Findings

### BLOCKER / manual before launch

- Production Supabase project, migrations, Auth URLs, SMTP/Auth email, PITR, Render services, production domain and production secrets have not been provisioned in this audit.
- External failure alerting is not yet configured and verified: `/api/health` uptime monitoring plus Render Web/Worker crash/fatal-exit notifications and a shared human destination are required.
- Production worker configuration must explicitly set `AI_REPORT_PROVIDER=openai` and provide `OPENAI_API_KEY`; the current `render.yaml` does not declare the selector, so the operator must set and verify it in Render before launch. Mock mode must remain limited to staging.

### HIGH

None found in the audited application contracts.

### MEDIUM

- Job and rate-limit retention is a future operations task. Review table sizes monthly and introduce tested cleanup before measurable index/query degradation.
- Russian-network smoke testing and external-pilot acceptance remain separate manual gates.

### LOW

None launch-blocking.

## Production environment contract

Values are names only; secrets must be generated and stored in Render/Supabase secret storage.

| Variable | Web | Worker | Secret | Production expectation / boot rule |
|---|---:|---:|---:|---|
| `SUPABASE_URL` | yes | yes | no | Production project URL; required at boot |
| `SUPABASE_PUBLISHABLE_KEY` | yes | yes | no | Production publishable/anon key; required at boot |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (privileged paths) | yes | yes | Production service-role key; required before privileged use |
| `APP_URL` | yes | yes | no | HTTPS production origin, no path/query; required |
| `AUTH_FLOW_SECRET` | yes | yes | yes | Fresh ≥32-character secret; required |
| `AI_REPORT_PROVIDER` | no | yes | no | Explicit `openai` in production; fail configuration review if absent |
| `OPENAI_API_KEY` | no | yes | yes | Required only when provider is `openai`; never client-side |
| `OPENAI_MODEL` | no | yes | no | Approved production model; set explicitly |
| `EMAIL_PROVIDER` | yes | yes | no | `resend` in production; `mock` staging-only |
| `RESEND_API_KEY` | yes (if email path runs web-side) | yes | yes | Required for `resend` |
| `EMAIL_FROM` | yes | yes | no | Verified sender domain/address |
| `CONSULTATION_NOTIFICATION_EMAIL` | yes | yes | no | Controlled operations recipient |
| `DATA_PROCESSING_POLICY_URL` | yes | no | no | Production legal URL |
| `MARKETING_POLICY_URL` | yes | no | no | Production legal URL |
| `WORKER_POLL_INTERVAL_MS` | no | yes | no | Valid bounded operational value |
| `WORKER_LEASE_SECONDS` | no | yes | no | Valid bounded lease value |
| `SCORING_MAX_ATTEMPTS` | no | yes | no | Explicit approved retry ceiling |
| `AI_MAX_ATTEMPTS` | no | yes | no | Explicit approved retry ceiling |
| `CONSULTATION_MAX_ATTEMPTS` | no | yes | no | Explicit approved retry ceiling |
| `AI_PROVIDER_TIMEOUT_MS` | no | yes | no | Explicit bounded provider timeout |
| `AI_CONCURRENCY` | no | yes | no | Explicit low-volume pilot concurrency |
| `INTERNAL_WORKER_SECRET` | no | yes | yes if used | Fresh secret if any internal check consumes it |

`NODE_ENV=production` is set by the image. `PORT` is supplied by Render. PDF/Playwright assets are image-baked; no PDF feature flag is required by the current contract.

## URL, email and backup contract

Replace staging Render origin in `APP_URL`, Supabase Site URL, allowed redirect URLs, confirmation and recovery redirects, canonical links and email links with the final production origin. Keep `audit.iteam.ru` disconnected until DNS/TLS and smoke gates pass. Verify the Resend sender domain and Supabase Auth sender configuration separately. External report email remains disabled from real-provider testing until the controlled staging/production approval.

The production Supabase plan must provide PITR for the approved database RPO ≤15 minutes. Daily backups alone do not satisfy that target. Application rollback is a Render image/revision rollback; migrations require expand/contract compatibility and operator review. Restore/replay must inspect jobs with external side effects before any replay.

## Ordered production checklist (manual)

1. Create an isolated production Supabase project and record its non-secret reference/region.
2. Apply all reviewed migrations through `20260916000400_rate_limits.sql`; verify versions, RLS, grants, indexes and claim functions.
3. Configure Supabase Site URL, confirmation, recovery and allowed redirect URLs for the final production origin.
4. Verify Auth SMTP sender/domain and application Resend sender/domain without sending broad mail.
5. Generate fresh production secrets; never reuse development or staging credentials.
6. Configure Render Web Service with production Supabase, `APP_URL`, legal URLs, `EMAIL_PROVIDER=resend` and required server secrets.
7. Configure Render Background Worker with `npm run worker`, production Supabase, `AI_REPORT_PROVIDER=openai`, explicit model, OpenAI key, email settings and bounded worker settings.
8. Verify no mock provider setting, secret, `.env` file or service-role key is present in browser bundles or image layers.
9. Configure DNS/TLS for `audit.iteam.ru`; update the origin/redirect settings and verify cookies are Secure and scoped correctly.
10. Deploy web, verify `/api/health` and `/ru`, then deploy the worker and verify persistent polling.
11. Configure Render web/worker failure notifications and an external HTTPS uptime monitor for `/api/health` (60 seconds, three failures, recovery alert) to a shared destination.
12. Run one controlled registration/confirmation/login using a designated test identity.
13. Run one controlled diagnostic with synthetic/non-customer data and verify deterministic scoring.
14. Run one approved real-AI report generation; inspect RU-1.3 grounding, schema, scores and fallback behavior.
15. Prepare/download the exact PDF, verify GET read-only and artifact binding.
16. Run one controlled report-email and consultation test using approved recipients; verify delivery/job state.
17. Submit feedback, verify history/regeneration and logout/login re-entry.
18. Inspect Render logs, queue summary, stale leases, terminal failures and alert delivery/recovery.
19. Stop launch if any ownership, secret exposure, worker persistence, PDF runtime, Auth callback or alerting gate fails.

## Rollback checklist

1. Stop promotion and record revision, migration and job state.
2. Roll back Web and Worker to the last known compatible image/revision.
3. Keep migrations backward-compatible; do not automatically roll back destructive schema changes.
4. Confirm `/api/health`, worker polling and queue leases recover.
5. Preserve the highest completed report; never replace it with generating/failed output.
6. For uncertain external-provider jobs, inspect delivery/request identity before replay; do not blindly replay.
7. If data/schema integrity is uncertain, pause writes and obtain operator/database review before restore.
8. Verify alerts, logs and user-facing safe errors after recovery.

## Launch decision

Application contracts are ready, but launch remains dependent on the manual production setup and external alerting gates above. No production resources, users, jobs, provider calls or DNS changes were performed.
