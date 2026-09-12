# Stage 9A — Scoring API ownership hardening

Status: **IMPLEMENTED; awaiting security/manual review**.

## Vulnerability

`POST /api/diagnostics/[diagnosticId]/score` previously checked only that a session existed and then passed the browser-supplied diagnostic ID to the service-role scoring worker. An authenticated user could therefore trigger scoring work for another diagnostic ID.

## Corrected boundary

The route now validates the UUID, loads the diagnostic through the authenticated Supabase client with `created_by_user_id = auth.uid()`, and verifies the linked company is owned by the same user. A missing or foreign diagnostic returns the same safe `404 not_found` response. Only after those checks can the service-role worker be invoked.

Administrator role does not grant arbitrary scoring access.

## Lifecycle

The privileged worker path is allowed only for `submitted` and the existing `scoring_failed` retry state. `in_progress` returns `not_ready`, `scoring` returns its current state without invoking the worker, and `completed` returns `completed` without rescoring.

No migration was required and RLS was not weakened. No runtime diagnostic, result, job, block result or AI report was changed during validation.

## Validation

Targeted ownership/lifecycle tests cover unauthenticated access, owner/non-owner/not-found behavior, spoofed ownership fields, completed/in-progress guards, retry state and the no-worker-before-authorization boundary. Stage 7–8 regression tests, typecheck, lint and production build remain required before review.
