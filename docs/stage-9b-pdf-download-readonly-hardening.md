# Stage 9B — PDF download read-only hardening

Status: **IMPLEMENTED; awaiting review/manual test**.

## Previous behavior

The user PDF GET route called `getPdfForReport`. If the artifact was missing, that helper rendered with Playwright and upserted a `report_artifacts` row during GET.

## New contract

`GET /api/reports/[reportId]/pdf` is strictly read-only. It authenticates, verifies the exact completed report and diagnostic ownership, resolves the exact `report_id + ai_report_version + template_version + format` artifact, and returns bytes only when the persisted artifact is `ready`. Missing, failed or not-ready artifacts return a controlled `409 pdf_not_ready` response. GET never renders, inserts, updates, enqueues or changes timestamps.

Preparation is explicit: `POST /api/reports/[reportId]/pdf/prepare` performs the existing authenticated ownership checks, reuses a ready artifact, or renders/upserts the exact bound artifact. The user button calls this explicit mutation and then performs the read-only GET. Admin artifact GET remains guarded by `requireAdmin` and reads existing ready bytes only.

The PDF template, report/version binding and DB base64 storage are unchanged. Moving artifacts to object storage is future hardening and is outside Stage 9B.
