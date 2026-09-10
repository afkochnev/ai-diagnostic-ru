# Implementation Plan

Status: planning only; implementation requires separate user authorization.

## Source authority and scope

Both `ARCHITECTURE.md` (A, sections 1–8) and `PRODUCT_SPEC.md` (P, sections 0–47) were read in full. P §0–0.1 governs precedence: product behavior, content, formulas and MVP follow P; technical architecture, security, physical persistence and infrastructure patterns follow A. This plan changes neither source. Open requirements are listed in `OPEN_DECISIONS.md`; identifiers such as D01 refer to that document.

Documentation and technical identifiers are English. User-facing content is Russian. Stage descriptions below are future work, not authorization to scaffold, install packages, create migrations or write application code now.

### Resolved interpretation of the two sources

| Topic | Implementation consequence | Sources |
| --- | --- | --- |
| Stack | Next.js App Router, strict TypeScript, Tailwind, Supabase PostgreSQL/Auth/Storage, server-only OpenAI adapter, server PDF, initial Vercel deployment; alternative stacks listed in P are not a new choice | A §§1–2; P §§0, 33, 41 |
| Company ownership | One primary company per user in MVP; saving updates it. Preserve A's owner relation and enforce MVP uniqueness transactionally/in the DB | P §§0.1, 7; A §3 |
| Methodology | Import the exact eight blocks and 80 supplied statements; do not ask for them again or alter wording. Missing open questions/metadata remain publication gates | P §§10–15, 31–32, 47 |
| Scoring | Internal 0–4, reverse `4 - score`, weighted block percentage and eight-block mean as specified; full precision plus one-decimal presentation. Missing boundary rules prevent final acceptance, not all development | P §§12–15, 47; A §4 |
| Auth | Supabase owns credentials. Do not implement `password_hash` in an application table or replace its password hashing | P §§0.1, 31, 35; A §§3–5 |
| Reports | Twelve semantic sections in validated JSON; no free-text marker parser required. New user-requested report revisions preserve answers and results | P §§0.1, 19–23; A §§3–4 |
| Statuses | Separate attempt, result and report states; expose Russian product statuses through a projection, not a single overloaded database status | P §§16, 22, 42; A §3 |
| Admin assessment | Do not implement an assessment workflow/table merely because A proposes it. P §0.1 explicitly defers this feature; user Feedback is required | P §§0.1, 26, 45; A §3 |
| Email | Report email is deferred and does not gate MVP. Consultation administrator notification is required and is a separate delivery use case | P §§0.1, 27, 45; A §4 |
| Operational security | Redact sensitive provider errors before restricted logging; do not log secrets/answers merely to satisfy P's request for full technical errors | P §34; A §5 |
| Russia access | Test the entire flow from multiple major Russian networks. A failed test blocks launch and requires infrastructure replacement under P §0.1; do not preemptively change the stack | P §§0.1, 37, 47 |

### Physical extensions needed for specified product behavior

These are planned additions using A's relational conventions, not migrations or amendments to A:

- `company_profiles`: typed fields for all twelve P §7 items; foreign keys to industry and revenue-range reference data; one-owner uniqueness for MVP, revision protection and submission snapshots.
- Reference tables such as `industries`, `revenue_ranges`, their translations, and `status_definitions` for configured labels/order. Status transition invariants remain validated server/database behavior; configuration cannot grant new privileges or arbitrary executable transitions.
- `user_consents`: separate versioned data-processing and optional marketing records, timestamp and registration source, linked to `users`; no password or duplicate authoritative Auth email.
- Methodology fields: `is_active`, `reverse_score`, `ai_context_label`/stable key, and a validated scoring/non-scoring block configuration in the existing versioned tables. `open_questions` is a non-scoring group, not a ninth contributor to the index.
- `diagnostics.current_block_id`: a version-consistent reference persisted with navigation; submission snapshots and results remain in A's dedicated tables.
- `diagnostics.current_report_id` and report archival metadata: relation integrity restricts the pointer to a revision for that diagnostic's result. Content/input immutability is distinct from lifecycle metadata updates.
- `lead_requests`: owner, company, diagnostic and report foreign keys; name/email/phone-or-Telegram/comment snapshots, configured status and timestamp. Parent relations must agree.
- `feedback`: user/company foreign keys, rating constrained to 1–5, useful/improve text, timestamps; cardinality and requiredness await D11.
- `analytics_events`: event type, anonymous session reference, nullable verified user reference, timestamp, minimal validated metadata and deduplication identity. No anonymous visit record in `users`.
- Consultation notification jobs extend A's durable job mechanism; report deliveries remain a later optional capability.

### Product state projection

| Product display | Physical basis |
| --- | --- |
| `В процессе` | Editable `diagnostics.in_progress`; includes a newly created attempt with its first current block |
| `Отправлена` | `submitted` or `scoring`, before a persisted successful result |
| `Дана оценка` | Deterministic result exists; does not mean administrative assessment |
| `Генерация отчёта` | Current report `pending`/`generating` |
| `Отчёт готов` | Current report `ready` |
| `Ошибка AI` | Current report `failed`; computed result remains available |
| `Черновик` | Listed by P, but a distinct visible trigger is unspecified; see D06, do not invent a separate editable workflow |

Keep scoring failure distinct from AI failure. Report `completed` in P maps to A's `ready`; archival is separate lifecycle metadata. A ready report's saved content never changes on regeneration.

## Stage sequence

Every stage has a reproducible build/type/lint gate once the project exists, relevant automated tests, manual browser verification for changed flows, documentation updates, and reviewed version-controlled migrations when applicable. Test credentials and fixtures are synthetic. Do not use real production API keys or client data. An unresolved decision blocks the affected behavior, not unrelated work, and must not be hidden by a default.

### Stage 1 — Browser foundation and public landing

**Goal:** deliver the smallest useful browser-testable result: the specified responsive Russian landing page and public registration entry, without pretending authentication already works.

- **Functionality:** initialize the approved stack only after authorization; Russian locale, shared layout, supplied landing copy/cards/steps/CTAs, mobile-first visual tokens, local font assets, localized error/not-found boundaries. Registration entry is explicitly an incomplete stage screen until Stage 2; no fake signup or fake diagnostics.
- **Pages:** public `/ru` landing, `/ru/register` entry; English technical route segments and future locale extension. No admin/dashboard placeholder data.
- **Components:** page container, buttons, cards, input/error primitives, landing sections, responsive navigation; supplied `#2F5774` text and specified visual style.
- **Tables and migrations:** none; no database prerequisite for this stage.
- **API / Server Actions:** none.
- **Business logic:** unauthenticated landing CTA routes to registration; no account/session claims.
- **Access:** public only; no secrets or customer data.
- **Tests:** production build/type/lint; landing CTA and locale browser checks; keyboard navigation and 393 px/mobile, tablet, desktop layouts; no horizontal overflow or critical external font dependency.
- **Completion:** a documented local URL opens the actual landing and its registration entry; supplied copy is present, responsive checks pass, and incomplete auth is clearly identified. This is a working public slice, not an MVP or a complete registration journey.
- **Dependencies:** implementation authorization only. D12's official logo blocks final branding acceptance, not this slice; do not invent a replacement logo.
- **Sources:** P §§4, 38–39, 46–47; A §§1–2, 6–7.

### Stage 2 — Identity, consent and protected navigation

**Goal:** real account creation, login, recovery and access control.

- **Functionality:** Supabase SSR Auth; registration fields and separate consent checkboxes; Russian validation/email templates; optional verification branch according to D01; login, recovery popup, one-use expiring reset, logout; trusted admin provisioning/MFA. Record consents consistently with successful account provisioning.
- **Pages:** `/ru/register`, `/ru/login`, conditional `/ru/verify-email`, `/ru/reset-password`, Auth callback; protected company-profile entry and admin entry. Incomplete product modules are not exposed as working features.
- **Components:** registration/login/reset forms, recovery popup, consent controls, session-aware shell, access-denied state, admin MFA controls.
- **Tables and migrations:** `users`, protected `user_roles`, `user_consents`, restricted audit foundations; `auth.users` stays Supabase-managed. Provision default `user` atomically; grants/RLS and generated types in the same stage.
- **API / Server Actions:** signup/login/logout/reset actions, callback handler, server session/role resolver; allowlisted return destinations.
- **Business logic:** no company after login → profile; company exists → Dashboard when Stage 3 lands; administrator → admin entry. Duplicate-email behavior and password policy follow D01, not a browser query into Auth users. Require versioned mandatory consent; marketing is independent.
- **Access:** validate identity on every protected entry; roles never accepted from editable user metadata; no protected content after logout/Back; require trusted admin role and MFA for admin surfaces.
- **Tests:** signup and repeated signup, both consent choices, verification branch, expired/reused recovery token, invalid login, rate limits, redirect abuse, role tampering, stale role revocation, logout cache and direct protected URLs; RLS allow/deny cases.
- **Completion:** synthetic users can register/login/recover/logout and reach only authorized entry points; Russian Auth emails and consent records are verified. Live registration cannot be accepted with invented legal text or an unresolved authentication policy.
- **Dependencies:** Stage 1; D01 and registration portion of D02. Company completeness redirect is fully exercised in Stage 3.
- **Sources:** P §§2.1.2–4, 2.1.17–20, 3, 5–6, 35–36; A §§3–5.

### Stage 3 — Company profile and initial Dashboard (authorized)

**Goal:** complete the first authenticated vertical slice: registration → company profile → personal Dashboard → edit profile.

- **Functionality:** all twelve specified profile fields, supplied industry/revenue choices, create/update one company, greeting and company summary, real empty-history state. Do not enable diagnostic creation until Stage 4 exists.
- **Pages:** `/ru/companies/[companyId]` plus a create-profile entry using the same form; `/ru/dashboard`.
- **Components:** profile form, reference selectors, optimistic-save state, Dashboard shell, company card and empty-history state.
- **Tables and migrations:** `company_profiles`, `industries`, `revenue_ranges` and localized reference data; owner uniqueness, indexed ownership and revision. RLS prevents changing owner IDs.
- **API / Server Actions:** read/save primary company actions through a guarded transactional upsert; minimal Dashboard read DTO.
- **Business logic:** repeated save updates the same row; successful save → Dashboard. Incomplete profile on later login → profile. Implement completion/field validation only after D03; no invented mandatory fields or numeric ranges.
- **Access:** user edits only their company; admin read access follows A; reference data read-only for clients.
- **Tests:** all fields round-trip, supplied options unchanged, simultaneous create does not duplicate company, stale edit conflict, cross-user reads/writes, incomplete-profile navigation, edit-save-return flow.
- **Completion:** a synthetic user can complete the full profile journey and reopen persisted data after logout/login. Existing owner records cannot be duplicated or reassigned.
- **Dependencies:** Stages 1–2; D03 for final field validation/completeness. Does not depend on missing diagnostic questions, weights or prompt.
- **Sources:** P §§0.1, 2.1.3–4, 2.1.14, 7–9, 25, 31, 47; A §§3–4.

### Stage 4 — Versioned methodology and resumable diagnostic

**Goal:** render stored methodology and durably save an attempt without implementing final scoring yet.

- **Functionality:** controlled import of the exact 80 statements, eight stable block keys and order, stored scale/options, metadata and non-scoring open-question group; draft validation/publication; idempotent start; block navigation, autosave, explicit save, leave/resume and persisted current block.
- **Pages:** Dashboard start/resume cards; `/ru/diagnostics/[diagnosticId]` with sequential block and open-answer states.
- **Components:** database-driven block renderer, scale selector, text/choice renderers for approved types, save indicator, progress, previous/next controls, missing-answer and revision-conflict feedback.
- **Tables and migrations:** A's definition/version/block/question/option/scoring-policy/maturity tables and translations; required P metadata; `diagnostics`, `answers`, `answer_selected_options`, transactional mutation deduplication, current-block FK, configurable status labels. Publish immutability, composite version constraints and ownership RLS.
- **API / Server Actions:** `POST /api/diagnostics`, `PATCH /api/diagnostics/{id}/answers`, guarded progress/current-block mutation and authorized attempt read; operator-only import/publication command, no invented admin methodology editor.
- **Business logic:** create before showing questions; duplicate start clicks reuse the intended attempt; save acknowledged before moving; Back means previous methodology block; resume uses persisted current block. Map displayed 1–5 to internal 0–4 if that presentation is selected. Missing input is never zero. Do not publish an incomplete production methodology or silently omit open questions.
- **Access:** owner-only attempt editing in `in_progress`; pinned versions readable for owners after retirement; user cannot mutate methodology or submit another version's questions/options.
- **Tests:** exact supplied 80-text import/count/order; type/scale validation; no duplicate answers; version pinning/retirement; cross-version selection rejection; lost response, repeated mutation, multi-tab conflict, browser restart and navigation-save failure; unauthorized direct database mutation.
- **Completion:** approved dataset can be loaded from DB, answered and resumed without losing acknowledged edits. Until D04–D06 resolve, only infrastructure and explicitly synthetic test versions can pass; the production methodology/whole stage cannot be called complete.
- **Dependencies:** Stage 3; D04–D06 for production behavior. Scoring engine is not required to test saving/resume.
- **Sources:** P §§2.1.5–8, 10–16, 31–32, 42, 44; A §§3–4, 6.

### Stage 5 — Submission, deterministic scoring and durable execution

**Goal:** freeze a complete attempt and produce reproducible authoritative results independently of AI.

- **Functionality:** full required-answer validation and links back to omissions; transactional submission/profile snapshot; scoring job; weighted block scores, total index, maturity; result/error status and recovery; start a new attempt after completion without answer copying.
- **Pages:** diagnostic final submit state, `/ru/diagnostics/[diagnosticId]/result`; Dashboard calculation/completion states. The next stage adds actual report generation.
- **Components:** submit validation summary, immutable result summary, eight block scores, processing/error status and elapsed-time display.
- **Tables and migrations:** `diagnostic_company_snapshots`, `diagnostic_results`, `diagnostic_block_results`, internal `jobs`, audit events; result uniqueness, numeric precision and provenance; shared row locking for save/submit, guarded worker commit and job lease/fencing fields.
- **API / Server Actions:** `POST /api/diagnostics/{id}/submit`, result/status read, authenticated internal dispatcher/runner; transactional claim, commit and retry operations. No client-supplied calculated values accepted.
- **Business logic:** apply P §§12–15 exactly; full-precision raw values and persisted one-decimal overall display; D05 determines rounding/boundary semantics. The supplied eight-block example must yield raw 63.75 and display 63.8. Ignore non-scoring open-answer groups for the index. Completed means deterministic result committed; AI failure does not reopen answers.
- **Access:** owner submits only their editable attempt; workers load stored targets; direct result writes prohibited; submitted answers/company snapshot immutable to ordinary users and administrators.
- **Tests:** golden specified example; min/max and reverse scale; approved weights and missing semantics; every maturity boundary and rounding tie; double-submit/save race, crash/retry, lease expiration, duplicate worker commit and restart recovery; historical company edit isolation.
- **Completion:** approved methodology fixtures agree exactly; one authoritative result survives retries; submitted data cannot change; background scoring works after browser closes. Unresolved D05 prevents final scoring acceptance.
- **Dependencies:** Stage 4 production configuration; D05, D06 and D07. AI credentials/prompt are not dependencies. Result commit must later enqueue report creation transactionally when Stage 6 is integrated.
- **Sources:** P §§2.1.9–11, 2.1.13–14, 12–17, 40, 47; A §§3–5, 7.

### Stage 6 — Structured AI reports, retries and revisions

**Goal:** interpret saved facts in the required report contract and preserve every report revision.

- **Functionality:** provider-neutral `AIReportProvider`, initial server OpenAI adapter, immutable input snapshot, versioned prompt/model configuration, asynchronous generation, elapsed timer, finite failure states, user retry and explicit regeneration.
- **Pages:** generation/result state at the diagnostic result route; `/ru/reports/[reportId]`; Dashboard report links/status.
- **Components:** generation popup/status, localized error/retry, twelve-section report renderer, company/date/index/maturity header, regeneration control and prior-report access.
- **Tables and migrations:** `report_templates`, `reports`, current-report FK/archive metadata, report jobs/audit records. Ensure report pointer and revision belong to the same result; content/input immutable once ready.
- **API / Server Actions:** authorized report/status read; `POST /api/diagnostics/{id}/reports` for deliberate new revision; `POST /api/reports/{id}/retry` for failed execution using the same stored revision/input; server worker adapter calls provider.
- **Business logic:** structured keys map one-to-one to all twelve P §19 sections. Enforce nonempty growth constraint, 3–5 strengths/problem zones, exactly three first actions, approximate period limits and 1000–1500-word target according to P §§18–20. Distinguish facts/inferences/best practice. Inject authoritative numeric results from DB; AI cannot replace them. New regeneration archives the previous report and atomically selects the new generating revision as P §22 specifies; old content remains accessible even if the new attempt fails. Transport retries are not user-requested regeneration.
- **Access:** owner or administrator can read; user regenerates only own diagnostic; guarded worker-only output writes; prompts/jobs inaccessible to browser; rate limits and no arbitrary model input from client.
- **Tests:** full input provenance; twelve sections and content constraints; empty growth constraint, invalid evidence, prompt injection and contradictory scores; 400/401/429/5xx/timeouts/refusals/malformed output; redacted logs, no raw provider errors; concurrent generation deduplication; history preserved and browser-close recovery.
- **Completion:** approved contract produces saved Russian reports based only on persisted facts; user can recover from AI failure without repeating questions; all views use stored revisions. Production AI cannot be accepted until D08 resolves.
- **Dependencies:** Stage 5; D08 and relevant D02/D07 provider-data/cost constraints. Open questions must be approved for the full MVP input, though provider adapter tests can use synthetic fixtures.
- **Sources:** P §§0.1, 2.1.10–12, 17–23, 33–34, 42–44, 47; A §§2–5.

### Stage 7 — Server PDF and private downloads

**Goal:** downloadable branded PDF generated from the exact saved report revision.

- **Functionality:** server renderer chosen by deployment spike; A4 eight-page target with P §24 section allocation, embedded Cyrillic font, explicit breaks, no clipping/blank trailing pages; private artifact caching and retry independent of AI.
- **Pages:** existing report with download/progress/error states; no navigation away for download.
- **Components:** download button/status; server PDF template with report cover, section pages and authoritative metrics.
- **Tables and migrations:** `report_artifacts`, private Storage bucket/object policies, PDF job kind, artifact uniqueness/checksum/template version.
- **API / Server Actions:** `GET /api/reports/{id}/pdf` for authorized existing download and an idempotent POST preparation operation when generation is needed; worker creates artifact. GET must not silently regenerate AI.
- **Business logic:** use the requested persisted revision; format percentages at most one decimal; protect old revisions' artifacts; handle overflow according to D12 without truncating report meaning or silently changing the page contract.
- **Access:** owner/admin only; private paths; authorization before streamed download or short-lived signed URL; no user-controlled external renderer resources.
- **Tests:** visual review of Cyrillic, long text, all sections, pagination and page count; PDF numeric equality to browser/result; duplicate preparation requests; cross-user and expired-link denial; Vercel runtime/memory limits.
- **Completion:** approved branded PDF downloads on mobile/desktop, all content is readable, and private access survives adversarial tests. Deployment spike and D12 are resolved for final acceptance.
- **Dependencies:** Stage 6, job runner from Stage 5, D12. No report-email dependency.
- **Sources:** P §§0.1, 2.1.12, 24, 37–39, 45; A §§3–5, 7.

### Stage 8 — Full Dashboard, consultation and product Feedback

**Goal:** complete the user's MVP path beyond the report.

- **Functionality:** full history cards with company/date/status/index/maturity/report; current attempt continuation and repeat attempts; consultation form with persisted lead and administrator notification; feedback popup after at least one completed diagnostic and thank-you return to the original page.
- **Pages:** `/ru/dashboard`, report page, profile navigation; modal lead and feedback forms preserve the underlying page.
- **Components:** history/status cards, resume card, consultation form, feedback rating 1–5 and useful/improve fields, thank-you states. Optional beta question is not added as mandatory scope.
- **Tables and migrations:** `lead_requests`, `feedback`, configured lead statuses, notification jobs and delivery tracking, ownership/parent consistency constraints. Feedback uniqueness/requiredness follows D11.
- **API / Server Actions:** authorized Dashboard/history query; create lead and feedback actions; lead+notification job atomic write; signed/deduplicated provider callbacks if required by selected notification transport.
- **Business logic:** consultation does not change Report; Feedback does not change diagnostic/report status. Persist a lead before reporting success; notification failures retry without creating another lead. User report email remains excluded. Existing feedback CTA suppression follows the approved D11 cardinality.
- **Access:** user creates only under own company/report; eligibility verified server-side; admin reads all; cannot forge notification target or other owners' IDs.
- **Tests:** all P §2.1 navigation states, repeat diagnostic/history preservation, old-company snapshot display, form validation, duplicate submit and notification failure, feedback eligibility/cardinality, popup return path, cross-user reference attacks.
- **Completion:** synthetic user completes landing → account → company → 80 questions → approved open questions → scores → AI → PDF → consultation → feedback without manual administrator intervention. Notification delivery is verified with a test destination.
- **Dependencies:** Stages 3–7, D10–D11. Dashboard shell/resume/results were incremental in earlier stages; the required navigation was not postponed until now.
- **Sources:** P §§2.1, 25–27, 31–32, 45; A §§3–5.

### Stage 9 — Complete administrator workspace

**Goal:** authorized inspection of all required product records and aggregate statistics.

- **Functionality:** admin home counts; searchable/paginated users, companies, diagnostics, reports, leads and Feedback; filters/reset; full company popup; answers, block scores and report details; feedback count/average. Funnel is added in Stage 10. No admin assessment, arbitrary score editing or unrequested lead-status workflow.
- **Pages:** `/ru/admin`, `/ru/admin/users`, `/ru/admin/companies`, `/ru/admin/diagnostics`, `/ru/admin/reports`, `/ru/admin/leads`, `/ru/admin/feedback`, relevant entity detail views.
- **Components:** admin shell, stat cards, searchable tables, company/date/status filters, detail panels, company profile popup, answer/block-result viewer, feedback summary.
- **Tables and migrations:** indexes and security-invoker views/authorized query functions over existing tables; restricted audit events. No duplicate business entities or `diagnostic_assessments` feature.
- **API / Server Actions:** administrator-only list/detail/aggregate reads with parameterized filters and pagination; server Auth contact lookup. Use database role checks, not client-hidden navigation.
- **Business logic:** all P §§28–29 profile fields, owner/email, diagnostic count/latest diagnostic/index/maturity; company filter reset returns all authorized records. Display result stage `Дана оценка` as scoring, not human review. Date-based definitions follow D13.
- **Access:** administrator with enforced MFA and current role only; ordinary users denied at route, API and DB layers; no privileged response caching shared with users.
- **Tests:** unauthorized route/API/RLS access; role revocation; correct filters/reset/pagination, contacts and latest-result joins; Feedback count/mean; no answer/result mutation path; sanitized admin error auditing.
- **Completion:** admin can inspect every entity in P §45, related answers/results and all required profile data; standard users cannot retrieve any admin data. Aggregate definitions verified against D13.
- **Dependencies:** Stages 2–8 and D13 for ambiguous aggregate/date semantics.
- **Sources:** P §§2.1.19, 3, 28–29, 31, 45; A §§3, 5, 7.

### Stage 10 — Product funnel and analytics

**Goal:** measure the specified six-stage funnel without duplicate counting or unsafe anonymous writes.

- **Functionality:** landing visit, signup, diagnostic start/completion, generated report and created lead events; association of anonymous session and authenticated user under approved privacy rules; admin funnel and, where approved, neighboring-stage conversions.
- **Pages:** `/ru/admin/funnel`; event hooks on existing routes/actions.
- **Components:** funnel counts, period/filter controls and conversion display once counting definitions are approved.
- **Tables and migrations:** `analytics_events`, event-type configuration, deduplication/indexes and server-only write/aggregate functions; no anonymous-user rows in `users`.
- **API / Server Actions:** bounded/rate-limited landing-event intake; authoritative lifecycle events emitted from successful server transactions/outbox; admin funnel reads.
- **Business logic:** named events follow P §30. Do not equate events, unique users and attempt counts without D09. Regeneration/repeated visits must not silently inflate conversions. Analytics failure cannot corrupt diagnostic state.
- **Access:** no public event reads or arbitrary user-ID/event spoofing; administrator-only aggregate visibility; minimal data and approved consent/retention.
- **Tests:** retry/reload/regeneration deduplication, anonymous-to-user attribution, time-window/cohort fixtures, forged events, denominator handling and privacy consent behavior.
- **Completion:** approved six-stage counts are reproducible and attributable to stored events; admin can verify totals against fixtures.
- **Dependencies:** Stages 8–9, D09 and analytics portion of D02. Event hooks may be prepared earlier once definitions resolve; no invented historical backfill.
- **Sources:** P §§28, 30–31, 36, 43; A §§3, 5, 7.

### Stage 11 — Production validation and release

**Goal:** demonstrate the full MVP is secure, recoverable and accessible from Russia.

- **Functionality:** isolated staging/production configuration, reviewed migration promotion, observability/runbooks, quotas, restore drills, accessibility/load/security QA and documented deployment procedure.
- **Pages/components:** all existing flows and operational error states; no new product feature.
- **Tables and migrations:** only reviewed corrective/index/retention migrations justified by testing; backup and storage recovery verification. No invented historical Bubble import.
- **API / Server Actions:** test every existing boundary, scheduled runner authentication and provider callbacks; no public debug endpoints.
- **Business logic:** end-to-end acceptance against P §45, reproducible approved scores and report contract, complete history, no manual administrator intervention in ordinary user flow.
- **Access:** production secrets never enter previews/browser; least-privilege roles, admin MFA/revocation, private PDF and cross-tenant checks; approved consent/retention applied.
- **Tests:** production build; core E2E including AI/PDF failure recovery; queue crash recovery; DB plus Storage restore; Russian network tests through multiple major operators covering HTML, JS, CSS, font/image resources, Auth, API, PDF and WebSocket if used; mobile network performance and cost ceilings.
- **Completion:** all MVP stages and relevant decisions resolved; real staging provider smoke tests use approved non-production credentials/data; Russian access evidence recorded; failed infrastructure dependency replaced and retested before production. Actual production deployment still requires its separately authorized action.
- **Dependencies:** Stages 1–10; D02, D07, D14, and all earlier MVP acceptance blockers. Report email/admin assessment are not launch gates.
- **Sources:** P §§0.1, 35–40, 45–47; A §§5, 7–8.

## Deferred capabilities

- **Report email:** only after separate confirmation (P §0.1). Reuse saved reports/private PDF and A's `report_deliveries`/jobs; decide actual transport/link/attachment semantics at that time. This does not defer required consultation notifications.
- **Administrative assessment:** no UI or workflow until separately specified (P §0.1); distinct from Feedback and calculated results.
- **Multiple companies, coworker access, optional beta feedback question, admin methodology editor:** not required to implement the current MVP; do not treat their optional design as global blockers.

## Что можно начать реализовывать уже сейчас

The following is ready to implement **after separate authorization**, without assuming missing product rules:

1. Stage 1's runnable public browser slice, locale structure, exact landing copy, supplied visual tokens and responsive primitives.
2. Stage 2's Supabase integration boundaries, profile/role/RLS foundations, server session checks and form structure. Final registration policy/legal handling remains gated by D01–D02.
3. Stage 3's twelve-field form structure, supplied industry/revenue references, owner/revision persistence and Dashboard layout. Final validation/completeness awaits D03.
4. Stage 4's versioned schema/import validation and faithful draft import of the 80 supplied questions; transaction/revision/version-integrity tests using clearly synthetic test data. Production publication awaits D04–D06.
5. Pure scoring contracts/tests for the specified example, report schema structure, job/PDF deployment spikes and integration adapters. These are partial later-stage tasks; they do not establish final scoring, prompt or release acceptance.

### Minimum first browser-testable stage

Stage 1 is the minimum: a locally running Next.js application showing the specified Russian landing with responsive content and a working route to the explicitly unfinished registration entry. It needs neither Supabase credentials nor missing methodology, consent texts or AI prompt. Its acceptance must include opening the actual browser, navigating the CTA and checking the 393 px layout.

The first **complete authenticated journey** is Stages 1–3: actual registration/login → persisted company profile → Dashboard → profile editing. This is larger than the minimum first stage and requires D01–D03 for correct final behavior. P §§46–47 permits starting these modules before missing methodology is resolved; it does not authorize fabricating their remaining validation or legal policy.

## Planning deliverable verification

This planning task creates only `IMPLEMENTATION_PLAN.md` and `OPEN_DECISIONS.md`. It does not create a Next.js project, `package.json`, SQL migrations or application source, and does not edit either source document.

## Stage 2 authorization and decision update

The user authorized Stage 2 only after Stage 1. D01 and the Stage 2 portion of D02 are now resolved as recorded in OPEN_DECISIONS.md. Mandatory email verification, eight-character passwords, independent versioned consent records and administrator MFA supersede the previously open authentication choices. Temporary legal UI is explicitly authorized for this stage; final legal texts and retention/erasure remain production release blockers. The user subsequently authorized Stage 3 and resolved D03; Company Profile and Dashboard are now implemented. Stage 4 remains unauthorized.
