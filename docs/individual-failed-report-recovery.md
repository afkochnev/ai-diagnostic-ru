# Versioned Individual report recovery

A completed diagnostic with a scoring result can request its next AI report
version. A failed v1 is retained; recovery enqueues v2 with `ai_report_v2`.
Earlier report inputs, status/errors and job attempts/errors are never reset.
PDF preparation remains the existing owner-authorized, report/version-bound flow.

The owner POST keeps `requireDiagnosticWrite`. The separate admin POST and GET
at `/api/admin/diagnostics/:diagnosticId/reports` require `requireAdmin`, including
the existing live database administrator/session check. Neither accepts caller
user/account identifiers as authority. POST is limited to 3 requests per admin
per day. GET exposes only id/version/status and a fixed `AI_REPORT_FAILED` class.
Provider errors, snapshots and answers are excluded. Admin UI polls this GET,
never the owner AI status endpoint.

`requestNextAIReportVersion` is server-only and requires callers to authorize
before invocation. It independently checks completed diagnostic/result, returns
an existing queued/generating version or chooses the highest version + 1. The
existing report and job unique constraints arbitrate concurrent enqueue calls;
the existing enqueue 23505 path returns the same version. No migration is needed.
Database read errors fail closed. No browser import of the core is supported.

## Staging acceptance

Use a new synthetic Individual diagnostic with a completed scoring result and
failed v1 plus a terminal, noneligible `ai_report_v1` job. Preserve full baseline
commitments of v1/job, scoring, answers, methodology and pre-existing rows.
Use a verified live admin session to open the diagnostic detail. Click the failed
recovery action once, observe v2 via admin GET, wait for terminal completion, then
prepare/download v2 PDF through the existing owner flow. Check failed v1 remains
visible and byte/row commitments equal, v2 has independent identity/job/PDF, and
foreign owners/ordinary users cannot use admin recovery. No extra provider retry
on an ambiguous result. No Team/W2, billing or production mutations.

Staging currently contains unmerged Team UAT changes. Do not deploy the main-based
recovery branch over it blindly: an acceptance build must overlay this exact
Individual-only delta on the pinned staging web/worker trees so their existing
Team behavior is preserved. Record that overlay SHA and its checks separately.

Claim `INDIVIDUAL_FAILED_REPORT_RECOVERY_STAGING_PASS` only after the actual
authenticated staging sequence and preservation checks, not from local mocks.

## Production is a separate authorization

Before any production retry, separately verify production worker runtime and
OPENAI_API_KEY presence without exporting the value. Inspect only safe presence /
configuration validity for FREE_SMOKE_RUN_ID, FREE_SMOKE_EXPIRES_AT,
FREE_SMOKE_ADMISSION_SHA256, FREE_SMOKE_EMAIL, FREE_SMOKE_DIAGNOSTIC_ID. Evaluate
the existing `freeSmokeConfig()` rules against actual runtime settings. If any
expired/partial controlled Free profile would block arbitrary Individual jobs,
STOP; do not remove env automatically. The current change neither edits this
profile nor authorizes a production deploy, retry or credential change.

PR #16/#17 remain unmerged. Methodology, owner RLS, Team/W2 and billing/YooKassa
are outside this change.
