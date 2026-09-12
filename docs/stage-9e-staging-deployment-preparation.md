# Stage 9E — Staging deployment preparation

Status: **READY FOR REVIEW; no remote resources created**.

## Selected target

The selected staging/external-pilot shape is a Render Web Service plus a
separate Render Background Worker, built from the same repository and Docker
image, with hosted Supabase for Auth/Postgres. The web command is `npm run
start`; the worker command is `npm run worker`. The worker has no public
listener. `render.yaml` is a declarative, non-provisioning blueprint with
`sync: false` secret placeholders.

Node is pinned to the locally tested `v26.8.1` major in `package.json` and
`Dockerfile`. The image installs Playwright Chromium and its Debian runtime
dependencies, runs as a non-root user, keeps `/tmp` writable, and never copies
`.env.local` or secrets into image layers. The web liveness endpoint is
`/api/health`; it reports process liveness only and does not inspect the
database or expose queue state.

## Secret scopes

Web receives the publishable Supabase key, the server-only service role needed
by admin/PDF/email services, public origin/legal URLs, and the request-driven
Resend/consultation variables. Worker receives the service role, OpenAI,
Resend and worker configuration variables. No private variable has a
`NEXT_PUBLIC_` prefix. Development credentials in `.env.local` must be
rotated and must not be copied to staging or production.

## Supabase staging contract

Create a separate non-local Supabase project manually, enable Auth and
Postgres, apply source-controlled migrations, configure `site_url` and the
exact `/auth/confirm` redirect, configure confirmation mail/SMTP, and verify
backups. The external-pilot RPO target is 15 minutes, therefore PITR is a
required dependency unless the owner explicitly changes that target. No
project or migration was created/applied by Stage 9E.

## Release and rollback runbooks

Release order: green tests/build/Docker scan; backup/PITR check; migration
status and reviewed migration apply; schema verification; web deploy and
`/api/health`; worker deploy; process/queue check; synthetic Russian PDF and
Auth smoke tests. Failed migrations stop the release. Web/worker can be
rolled back independently only when schema compatibility is verified;
database rollback is an operator-reviewed recovery/forward-migration action.
After restore, do not automatically replay AI, email or consultation jobs
whose provider outcome is unknown.

## Deferred gates

The Docker/Chromium image must pass a non-production synthetic Russian PDF
smoke test for memory, timeout, `/tmp` cleanup, fonts and concurrent renders.
DB base64 artifact storage remains unchanged and is future hardening. No DNS,
Render resource, Supabase project, production secret or runtime data was
modified.

## Stage 9E.1 local validation

The image was built successfully for `linux/arm64` from
`node:26.8.1-bookworm-slim`. The final image runs as UID 1001 (`app`), exposes
the Playwright arm64 Chromium 153.0.8010.12 executable, has Russian-capable
font packages and a writable `/tmp`. Build-time environment values are
non-secret placeholders; runtime secrets are injected by the service.

The web container started on `0.0.0.0`, returned HTTP 200 from `/api/health`
and served `/ru`. The worker container connected to the local Supabase
network, remained idle without a busy loop, handled SIGTERM with exit code 0,
and restarted successfully. No provider calls or business fixtures were
used.

A synthetic Russian report rendered inside the web container in 3.7 seconds
and produced a readable 26-page PDF with Cyrillic text. Two concurrent renders
completed in 2.1–2.2 seconds each; observed web memory was approximately
250 MiB idle and 599 MiB peak during the concurrent run, within the local
3.825 GiB Docker limit. Chromium/browser cleanup is enforced by `finally`,
and PDF rendering now has a bounded `PDF_RENDER_TIMEOUT_MS` (default 120 s,
clamped to 5–300 s). A controlled hanging fixture produced
`pdf_render_timeout` at the 5-second test bound with no Chromium process left;
a controlled launch failure returned a bounded Playwright error. Render
compatibility is therefore **LIKELY**, not proven until Render execution.

The container acceptance covered startup, idle polling, SIGTERM/restart,
renderer execution, failure/timeout cleanup and concurrent rendering. Live
scoring, AI and consultation job cycles were not run in the container because
the deploy image intentionally contains no fixture loader and no customer
data was permitted; their mock/DB-backed coverage remains in Stage 9C tests.

## Operational decision record

The web and worker are independent Render processes using the same image:
`npm run start` listens on the platform `PORT` through `0.0.0.0`, while
`npm run worker` has no inbound listener and is supervised by Render restart
policy. The worker requires outbound Supabase, OpenAI and Resend access; the
web service requires inbound HTTPS and its request-driven Supabase/PDF/email
dependencies. Private database access should be restricted to Supabase
endpoints and service credentials injected by Render, never baked into the
image.

For the pilot, hosted Supabase is preferred over self-hosting. A separate
staging project, source-controlled migrations, Auth redirect configuration,
confirmation mail/SMTP and PITR are prerequisites. The target is database RPO
≤15 minutes and worker RTO ≤15 minutes. After restore, jobs with an unknown
external provider outcome require operator review rather than automatic replay.

The release sequence is tests/build and secret scans, backup/PITR check,
migration verification and apply, schema check, web deploy and health check,
worker deploy and process/queue check, then synthetic Russian PDF and auth
smoke tests. Web and worker rollback is allowed only with schema compatibility;
database rollback is an operator-reviewed recovery decision. External alert
destination, exact Render plan, backup retention tier and Playwright resource
limits remain owner decisions. Remote Render compatibility and Russian-network
smoke remain pending until a staging deployment.

## Stage 9E.3 live container worker acceptance

On 2026-09-12, host-created committed fixtures were inserted into the local
Supabase/Postgres database using a unique `stage9e3_` run marker. The
deployable `ai-diagnostic-stage9e1:local` image ran the real `npm run worker`
entry point with `AI_REPORT_PROVIDER=mock` and `EMAIL_PROVIDER=mock`.

The isolated scoring fixture completed once and produced one deterministic
result with eight block results; scoring then enqueued and completed the exact
AI report fixture (version 1) through the same container. A consultation
fixture subsequently completed once with a mock provider message. Kind-scoped
claims were observed for `score_diagnostic`, `ai_report`, and
`consultation_notification`; no handler processed another kind. The queue
returned to idle, SIGTERM exited cleanly, and a clean restart did not
reprocess completed jobs (attempts and business-row counts remained one).

Container logs contained only job/lifecycle-safe fields and no credentials or
sensitive payloads. OpenAI, Resend and email network calls were zero. All
`stage9e3_` users, company, diagnostic, answers, snapshot, jobs, reports,
results, lead and delivery rows were explicitly removed; no pre-existing local
business rows changed. This closes the final local container job-cycle gate.

Stage 9E is **ACCEPTED** as staging deployment preparation. Render
compatibility remains **REQUIRES REMOTE PROOF**; no Render or remote Supabase
resources were created and Stage 9F is not started.
