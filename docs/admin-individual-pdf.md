# Individual admin PDF

An administrator can prepare a PDF from an existing completed Individual report without an owner session. This is a separate live-admin boundary; ordinary owner and Team authorization is unchanged. No owner identity is passed to owner helpers, and no Auth link, membership, AI report/job or scoring operation is created.

- `GET /api/admin/reports/:reportId/pdf`: read-only metadata for the exact ready report/version/template/artifact. Missing PDF returns `409 pdf_not_ready`. It never renders or prepares.
- `POST /api/admin/reports/:reportId/pdf/prepare`: explicit empty-body, same-origin action, limited to 5/hour per actual administrator. It rechecks the verified live administrator independently in the service and through an uncached `read_admin_console(identity)` before publishing/joining completed work.
- The existing `GET /api/admin/report-artifacts/:artifactId` downloads the bound ready artifact and independently requires administrator access.

The Admin Console control is shown on completed Individual report versions. It checks status only when clicked, requires a separate preparation click, disables duplicate in-flight clicks, and stops on an unknown/error response. There is no automatic POST, HTML-login success, provider call or retry timer.

The renderer and `stage12-1i` template are unchanged. Preparation uses saved report content, company snapshot and deterministic results. The current saved RU-1.0 content schema is checked without importing AI clients. Source commitments are checked again after rendering; changed inputs stop publication.

A ready PDF is validated against report/version/format/template, canonical base64, PDF signature/EOF, 10MiB maximum and SHA256 checksum before reuse. New PDFs use INSERT, never upsert. The existing unique tuple and report/version foreign key arbitrate across runtimes; a 23505 conflict reads and validates the exact winner. Failed/corrupt historical entries are not reset or overwritten. GET remains read-only. Every owner/admin waiter authorizes independently before joining and after completion.

Safe service events contain only finite stage/error codes, actual administrator ID, report/version/template/artifact ID, timestamp and file checksum. They contain no prompts, answers, report text, arbitrary exception material or credentials. This web-only change adds no DB actor-audit column: protected logs and a separately sealed execution receipt are the audit evidence for an authorized operator run.

## Validation and release

Tests mock the renderer and all database/auth ports. They do not generate PDFs, send email, call AI or access hosted credentials. Negative route/service tests cover stale/revoked/session authority, malformed inputs and cross-origin requests; cache/integrity/source/race tests retain historical artifacts. Existing owner/Team behavior is covered by regression suites.

No migrations, worker, env/secrets, methodology, PDF template or billing changes. This PR is not approval to deploy or prepare a hosted PDF. Required sequence: exact head CI, separately approved synthetic staging acceptance, separately approved canonical production web rollout, then one separately approved preparation for an exact completed report. An ambiguous request is reconciled read-only; never resend automatically. Production recovery v2 and its job must stay unchanged.
