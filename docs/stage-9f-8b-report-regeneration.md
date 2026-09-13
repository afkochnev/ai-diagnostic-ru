# Stage 9F.8B — Authenticated Report Regeneration

The report page exposes an authenticated `POST /api/diagnostics/[diagnosticId]/reports` mutation. The request contains only the diagnostic identifier. The route obtains the signed-in identity, verifies ownership, requires a completed diagnostic and a persisted deterministic result, and then delegates to the server-side regeneration service.

The service reads existing report revisions and allocates the next version on the server. A queued or generating revision is returned instead of creating another one. Database uniqueness on `(diagnostic_id, version)` and the `ai_report` deduplication key make concurrent requests converge on one revision and one durable job. Provider execution is performed later by the worker; the web request never calls OpenAI.

The existing completed report remains immutable and usable while a new revision is queued or generating. A failed revision does not hide it. Report selection continues to use the highest completed revision, so a completed v2 becomes usable only after it is persisted as completed. The UI action, `Сформировать новый отчёт`, is deliberately secondary, disables duplicate submissions, keeps the current report visible, and polls the existing AI status endpoint for completion or failure.

This entry point is intended for the later controlled staging real-provider test. That test must explicitly switch the staging worker provider, trigger one revision, review v2, and restore mock mode; no provider call is made by this implementation or its tests.
