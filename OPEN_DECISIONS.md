# Open Decisions

Status: missing requirements only; no implicit defaults or changes to the source documents.

Both source documents were read in full. Stage numbers refer to `IMPLEMENTATION_PLAN.md`. Each entry is a `TODO / requires product decision`, or an explicitly identified technical/operational choice required to activate the affected integration. Routine implementation details are not product questions. Work on unrelated stages can continue after implementation authorization.

## D01 — Resolved for Stage 2 by the user

- Email verification is mandatory before application access. After verification, resolve the destination from trusted company ownership: missing profile → company creation; existing profile → Dashboard. Stage 2 has no company entity, so only the protected company-entry handoff exists; Stage 3 must connect the actual company lookup.
- Minimum password length is eight characters; no forced special characters, digits or case combinations.
- Use Supabase's standard expiring one-use recovery flow. The local configuration uses its one-hour token default, secure password change and refresh-token rotation. Recovery UI requires a server-signed, session-bound proof created only after successful recovery-token verification.
- Every new user receives `user` through a database trigger, ignoring signup role metadata. Role provisioning is trusted SQL/operator-only and audited. Administrator access requires a verified TOTP second factor (`aal2`) in server authorization and RLS.
- Keep Supabase's anti-enumeration behavior: duplicate signup gets the same email-verification state; no account-existence lookup endpoint. Incorrect login uses the specified generic Russian message.
- Status: these decisions no longer block Stage 2. Company existence integration belongs to Stage 3, not Stage 2.

## D02 — Open: production privacy and retention requirements

- The user approved Stage 2 development with the exact temporary checkbox copy from PRODUCT_SPEC §5. Data-processing consent is mandatory; marketing is optional. Store separate records for both decisions, each with version, server timestamp, source and granted status.
- `consent_documents` holds current versions; both start at explicitly temporary `temporary-ru-v1`. Signup validates the versions presented to the user against the database before committing the identity and consent records atomically. Later editable metadata cannot rewrite consent history.
- Document URLs are replaceable through server configuration. The temporary legal pages explicitly say the documents are not yet approved; they do not invent legal terms.
- **Status:** OPEN. Approved legal texts/versions, jurisdiction/hosting requirements, retention and erasure across Auth/DB/Storage/providers, marketing lifecycle, any justified IP collection and analytics consent remain unresolved. No IP is collected in consent records at this stage.
- **Affected stages:** production readiness (Stage 11), and later personal-data/analytics modules when applicable.
- **Can work continue?** Yes. These remaining decisions do not block Stage 2 implementation and synthetic-data verification. They block public production registration/release until approved.

## D03 — Company field validation and completeness — Resolved for Stage 3

- **Decision:** All twelve P §7 fields are mandatory. Text fields require nonempty trimmed text without artificial minimum lengths. Country is free text for MVP. Industry and annual revenue use the Russian reference tables from P §§8–9. Employee count is an integer greater than zero; company age is a nonnegative integer; management levels is an integer of at least one.
- **Affected stages:** 3 and diagnostic eligibility in later stages.
- **Status:** resolved by product instruction before Stage 3 implementation.

## D04 — Methodology content and publication metadata — Resolved for Stage 4

- **Decision:** `METHODOLOGY_RU_1_0.csv` is the authoritative Bubble export for RU-1.0. It defines all 10 blocks, 84 questions, exact Russian text, order, question keys, weights, required/active flags, reverse flags, answer types and legacy provenance fields.
- **Affected stages:** 4 import/publication and later scoring/report integration.
- **Status:** RESOLVED. Решение зафиксировано пользователем; содержимое берётся из актуального Bubble-экспорта.

## D05 — Missing-answer, rounding and classification semantics — Resolved for Stage 5

- RU-1.0 has no «Не применимо». Eighty scale questions and two `company_info` text questions are required; two `open_questions` text questions are optional and excluded from scoring. Missing means no Answer, never score zero. Inactive questions are hidden and excluded from denominators.
- Stored scale values are 0–4 from user-facing 1–5. Reverse scoring uses `4 - stored_score`. Block score is `(sum(effective_score * question_weight) / sum(4 * question_weight)) * 100`; overall is the block-weighted mean of the eight scoring blocks. Intermediate values are not rounded and display uses decimal ROUND_HALF_UP to one decimal.
- Maturity is classified from the raw overall value at [0,30), [30,50), [50,70), [70,85), [85,100]. RU-1.0 has equal weights and all reverse flags false. Submit validates all 82 required answers; navigation does not.
- **Affected stages:** 5 scoring and submission; later report integration.
- **Status:** RESOLVED. D05 больше не блокирует детерминированный scoring.

## D06 — In-progress lifecycle and draft meaning — Resolved for Stage 4 MVP

- **Decision:** A company has at most one unfinished diagnostic. It never expires or deletes automatically, has no separate user-facing draft status, and starts immediately as `in_progress`. A repeated start request returns the existing attempt. After completion, a new attempt may be created; submitted/completed attempts remain immutable and non-editable.
- **Affected stages:** 4 start/resume and later completion/history flows.
- **Status:** RESOLVED. Решение зафиксировано пользователем.

## D07 — Durable execution and operational budgets

**Status: IMPLEMENTATION IN PROGRESS (Stage 9C).**

Stage 9C fixes the core runner model: one long-running Node process, explicit
kind-specific atomic claims, five-minute leases with reclaim/fencing, bounded
attempt ceilings (scoring/AI 3, consultation 5), two-second polling and
server-only execution. Production deployment, scheduler/hosting choice,
provider budgets, alerting, RPO/RTO and operational acceptance remain open.

- **Question:** Select the job dispatcher/runner deployment after the required Vercel feasibility spike. Supply expected volume, acceptable waiting times, generation/notification quotas, retry/cost ceilings and production recovery objectives (RPO/RTO).
- **Why necessary:** A §§4, 7–8 explicitly leaves runner/budgets/recovery targets to be selected; P §40 gives only qualitative page timing and approximate AI duration. Durable jobs, leases, idempotency and server execution are already fixed, not open choices.
- **Affected stages:** 5 job activation; 6–8 provider execution; 11 production capacity/restore acceptance.
- **Can other work continue?** Yes: queue contracts, local transaction/recovery tests and other modules. Final deployed worker configuration and launch acceptance require measured feasibility and approved budgets.

## D08 — Approved production prompt and AI configuration

- **Status:** RESOLVED for prompt/schema. `AI_REPORT_PROMPT_RU_1_0.md` and `AI_REPORT_SCHEMA_RU_1_0.json` are authoritative. Model and operational parameters remain configurable; default model is `gpt-5.6-sol`.

- **Question:** Supply or approve the exact versioned production prompt/equivalent structured-output contract and the initial configurable OpenAI model selection with acceptance criteria for reviewed Russian outputs.
- **Why necessary:** P §§0.2, 18–20, 33, 47 gives the twelve-section content/quality requirements and provider interface but explicitly omits the production prompt. A requires model/prompt provenance. Generating an unapproved prompt and calling it final would change the report contract.
- **Affected stages:** 6 final integration; 7 representative layout validation; 11 report-quality acceptance.
- **Can other work continue?** Yes: scoring, report schema, mocked provider/error handling, input provenance and PDF fixtures. Real production AI is not complete without approval. The report's sections, regeneration capability and server-only OpenAI boundary are already resolved.

## D09 — Funnel counting and attribution

- **Status:** CLOSED for Stage 8G metrics. The primary funnel is a diagnostic funnel deduplicated by unique `diagnostic_id`. Cohort membership is determined by `diagnostics.started_at`; date boundaries are UTC and the cohort is evaluated against current persisted state.
- **Stages:** started → completed (`status = completed` and `completed_at` present) → at least one completed AI report → at least one consultation lead. Feedback count is shown separately and feedback conversion is `diagnostics with feedback / completed diagnostics`.
- **Operational rules:** report versions, delivery attempts and PDF artifacts do not duplicate funnel diagnostics; visitor/page-view, anonymous tracking, PDF-download, inbox-delivery and consultation-completion metrics are not implemented. Allowed conversions use only the approved diagnostic denominators and show “Нет данных” for zero denominators.
- **Affected stages:** Stage 8G. Future analytics instrumentation requires separate privacy/retention decisions under D02.

## D10 — Consultation validation and administrator notification

- **Question:** Which lead form fields are required, and what valid phone/Telegram input is accepted? Which notification channel/provider and controlled administrator destination must receive new leads?
- **Why necessary:** P §27 lists the fields and mandates a notification, but supplies neither validation/cardinality details nor a channel/recipient. A's email discussion concerns report delivery and does not supply a consultation destination.
- **Affected stages:** 8; 11 complete MVP path.
- **Can other work continue?** Yes: report/Dashboard and lead persistence/outbox structure. A synthetic notification adapter can test failures, but actual delivery cannot be declared complete without its destination/transport. Report email remains optional and is not this decision.

## D11 — Feedback cardinality and required fields

- **Decision:** Feedback belongs to a completed diagnostic. At most one immutable record is allowed per `(user_id, diagnostic_id)`; a user may submit feedback again for a later completed diagnostic. `company_id` is retained for analytics and future administration. `rating` is required and constrained to 1–5; `useful` and `improve` are optional trimmed text values normalized to NULL. No edit after submission and no beta wording question in MVP. Feedback persistence does not create jobs or notifications. The completed result page exposes `Оценить аудит`; after submission the CTA is hidden.
- **Status:** RESOLVED for Stage 7D. Feedback is not bound to an AI report version.
- **Affected stages:** 7D persistence/UI; future Admin UI aggregates.

## D12 — Branded PDF assets and overflow acceptance

- **Question:** Provide the official red iTeam logo asset required in the PDF/UI. Is eight A4 pages a strict limit for all valid report content, and what approved treatment applies when required content does not fit: content-length constraints/retry, controlled layout adjustment, or permitted extra pages?
- **Why necessary:** P §§24, 39 specifies color/style and an eight-page format while requiring long-text wrapping with no truncation or blank extras. Neither document supplies the logo or resolves overflow for variable 1000–1500-word reports. Do not invent a logo, cut sections or silently change page count.
- **Affected stages:** 1 final branding, 7 PDF acceptance; 6 if prompt length constraints need refinement.
- **Can other work continue?** Yes: landing without invented branding, renderer deployment spike, template and synthetic typography tests. Exact library selection is an engineering spike per A, not another product question.

## D13 — Latest/current semantics

- **Status:** CLOSED.
- There is no global business concept of a “current diagnostic”. The sole active attempt is the company’s `in_progress` diagnostic; completed attempts remain history and downstream routes use an explicit `diagnostic_id`.
- Dashboard resume targets the exact active diagnostic and persisted block. Completed history is presentation-sorted by `started_at DESC`; this ordering is not a current/latest business claim. If a completed summary is needed later, its canonical rule is `status = completed AND completed_at IS NOT NULL`, ordered by `completed_at DESC, id DESC`.
- For an exact diagnostic, the usable AI report is the highest `version` whose status is `completed`. A newer failed or generating report never hides an older usable completed report. If no completed report exists, the UI shows the persisted generating/failed/no-report state without rendering unfinished content or creating a report.
- `company_profiles` is the canonical current profile. A completed diagnostic uses its immutable `diagnostic_company_snapshots.profile_data`; if that snapshot is missing, the UI reports that the historical profile is unavailable and does not silently substitute current data. An unfinished diagnostic may use the current profile until its snapshot is created.
- PDF and report-email records remain explicitly bound to their report/version/artifact. No implicit latest PDF, email attachment, lead or feedback semantics are introduced. Presentation sorting in admin history is not a business selection.
- **Affected stages:** diagnostic result and Stage 8C historical profile integrity; prior accepted stages retain their explicit-ID/version contracts.

## D14 — Historical migration scope

- **Question:** Is migration of historical Bubble users, companies, attempts, answers and reports required for the launch? If yes, provide exports/schema, allowed identity onboarding and acceptance/reconciliation requirements.
- **Why necessary:** P §0.2 and A §§1, 8 explicitly leave this scope unresolved. P §45's new-user MVP can be built without it, but launch scope cannot assume that history is disposable or that passwords are portable.
- **Affected stages:** 11 launch scope and a separately planned import stage only if confirmed.
- **Can other work continue?** Yes: every new-user MVP stage. Do not create import migrations or make historical-data promises before the scope decision.

## Not open and not additional blockers

Do not request the 80 scored question texts, eight block names/keys, internal 0–4 scale, reverse transform, base formulas, five maturity labels, profile field list, industry/revenue options, twelve report sections, single-company MVP, mandatory Feedback, report regeneration, server PDF, Russian language, mobile-first styling, Supabase Auth/RLS or Russian-access release gate again: the sources already provide them.

Do not add decision requests for a scoring override, coworker access, multiple-company UI, a methodology editor or administrative assessment. These are not required MVP functionality. Report email provider/attachment settings can be decided if that deferred feature is explicitly authorized; they do not block current MVP planning. Mandatory Russian network verification is a test obligation, not an unanswered product preference.

## Что можно начать реализовывать уже сейчас

After separate authorization, Stage 1 can be completed independently of the missing diagnostic methodology. Auth/profile foundations, role/RLS design, supplied reference data, faithful draft question import and isolated transaction/report-contract tests can also proceed within their stated limits. See the implementation plan for the smallest browser slice and per-stage acceptance gates. No decision's passage of time constitutes approval, and unresolved final behavior must remain visibly incomplete rather than defaulted.
