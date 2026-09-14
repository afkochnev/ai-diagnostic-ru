# Stage 9B — PDF GET Side-Effect Hardening

PDF download is split into two operations. `GET /api/reports/[reportId]/pdf` authenticates the owner, verifies the completed report and its exact version, and reads only a `ready` artifact bound to that report, version, format, and template. A missing or non-ready artifact returns a safe `409 pdf_not_ready`; GET performs no Playwright call, write, state transition, or enqueue.

Preparation remains an explicit authenticated `POST /api/reports/[reportId]/pdf/prepare`. It derives all identity and report metadata server-side, reuses an existing ready artifact, renders only when needed, and persists the artifact with the existing uniqueness constraint. Duplicate requests in one web process are serialized by a keyed promise lock; database uniqueness remains the final artifact identity boundary. Preparation and email continue to use the exact report/version binding.

The download UI prepares first and then performs the read-only GET. Failed preparation exposes only a generic retry message. Admin artifact download remains separately protected by `requireAdmin`. No storage migration or real PDF generation is part of this hardening.
