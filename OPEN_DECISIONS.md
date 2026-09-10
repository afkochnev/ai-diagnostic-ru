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

## D02 — Stage 2 consent decisions resolved; release blockers remain

- The user approved Stage 2 development with the exact temporary checkbox copy from PRODUCT_SPEC §5. Data-processing consent is mandatory; marketing is optional. Store separate records for both decisions, each with version, server timestamp, source and granted status.
- `consent_documents` holds current versions; both start at explicitly temporary `temporary-ru-v1`. Signup validates the versions presented to the user against the database before committing the identity and consent records atomically. Later editable metadata cannot rewrite consent history.
- Document URLs are replaceable through server configuration. The temporary legal pages explicitly say the documents are not yet approved; they do not invent legal terms.
- **Release blocker:** approved legal texts/versions, jurisdiction/hosting requirements, retention and erasure across Auth/DB/Storage/providers, marketing lifecycle, any justified IP collection and analytics consent remain unresolved. No IP is collected in consent records at this stage.
- **Affected stages:** production readiness (Stage 11), and later personal-data/analytics modules when applicable.
- **Can work continue?** Yes. These remaining decisions do not block Stage 2 implementation and synthetic-data verification. They block public production registration/release until approved.

## D03 — Company field validation and completeness — Resolved for Stage 3

- **Decision:** All twelve P §7 fields are mandatory. Text fields require nonempty trimmed text without artificial minimum lengths. Country is free text for MVP. Industry and annual revenue use the Russian reference tables from P §§8–9. Employee count is an integer greater than zero; company age is a nonnegative integer; management levels is an integer of at least one.
- **Affected stages:** 3 and diagnostic eligibility in later stages.
- **Status:** resolved by product instruction before Stage 3 implementation.

## D04 — Missing methodology content and publication metadata

- **Question:** Supply exact open questions, order, types, requiredness and semantic context labels. Confirm the per-question metadata for RU-1.0 (`weight`, `is_required`, `is_active`, `reverse_score` and any nonstandard validation) and whether the eight block weights are equal. If semantic labels have an existing required mapping, supply it; otherwise technical keys can be assigned without changing meaning.
- **Why necessary:** P §§0.2, 10–12, 31, 47 supplies all 80 scored statements but explicitly identifies missing open questions/metadata. “Positive wording” does not authorize guessing every production reverse flag, and examples with equal weights do not confirm the complete production dataset.
- **Affected stages:** 4 publication; 5 scoring acceptance; 6 complete AI input; 11 MVP gate.
- **Can other work continue?** Yes: Stages 1–3, faithful draft import of supplied statements and synthetic engine tests. Do not silently publish defaults or omit open questions.

## D05 — Missing-answer, rounding and classification semantics

- **Question:** Define skipped/not-applicable/inactive-answer treatment and denominator behavior; confirm whether those answer states are allowed at all. Confirm rounding mode, whether any intermediate rounding is permitted, whether maturity uses raw or rounded index, and continuous boundary handling around 29.9/30, 49.9/50, 69.9/70 and 84.9/85. If D04 supplies unequal block weights, provide the authoritative overall aggregation rule for that case. Specify block-level required-answer enforcement versus final-submit-only enforcement.
- **Why necessary:** P §§12–15 already supplies the internal 0–4 scale, reverse transform, block formula, equal-block mean, five labels and displayed example 63.8. These are not open. P §§0.2, 2.1.6, 47 and A §4 leave the listed edge cases unresolved; interpreting decimal interval gaps or omissions can change results.
- **Affected stages:** 4 navigation validation; 5 final scoring; 6–7 displayed authoritative values; 11 equivalence acceptance.
- **Can other work continue?** Yes: Auth/profile/autosave and pure tests for explicitly specified cases. The final engine cannot be accepted until result-changing choices resolve. Ask for authoritative boundary fixtures as evidence of the decisions, not a replacement formula.

## D06 — In-progress lifecycle and draft meaning

- **Question:** What is the lifetime/expiry or abandonment policy for unfinished attempts? What should an intentional “New diagnostic” request do while an unfinished attempt exists, and is a separate user-visible `Черновик` state needed beyond creation of an `in_progress` attempt? Specify any transition that makes it distinct.
- **Why necessary:** P §§0.2, 2.1.5, 16 leaves lifetime/concurrent-attempt policy open and lists draft without defining a separate transition. Duplicate clicks must already be deduplicated; multiple simultaneous unfinished attempts must not be introduced without approval. A's technical statuses need a precise product projection.
- **Affected stages:** 4 start/resume; 5 completion; 8 Dashboard.
- **Can other work continue?** Yes: one-attempt persistence/resume, idempotent creation and later scoring/report modules in isolation. Do not invent deletion, expiry, abandonment or a concurrent-attempt UX. Already submitted data remains immutable as specified.

## D07 — Durable execution and operational budgets

- **Question:** Select the job dispatcher/runner deployment after the required Vercel feasibility spike. Supply expected volume, acceptable waiting times, generation/notification quotas, retry/cost ceilings and production recovery objectives (RPO/RTO).
- **Why necessary:** A §§4, 7–8 explicitly leaves runner/budgets/recovery targets to be selected; P §40 gives only qualitative page timing and approximate AI duration. Durable jobs, leases, idempotency and server execution are already fixed, not open choices.
- **Affected stages:** 5 job activation; 6–8 provider execution; 11 production capacity/restore acceptance.
- **Can other work continue?** Yes: queue contracts, local transaction/recovery tests and other modules. Final deployed worker configuration and launch acceptance require measured feasibility and approved budgets.

## D08 — Approved production prompt and AI configuration

- **Question:** Supply or approve the exact versioned production prompt/equivalent structured-output contract and the initial configurable OpenAI model selection with acceptance criteria for reviewed Russian outputs.
- **Why necessary:** P §§0.2, 18–20, 33, 47 gives the twelve-section content/quality requirements and provider interface but explicitly omits the production prompt. A requires model/prompt provenance. Generating an unapproved prompt and calling it final would change the report contract.
- **Affected stages:** 6 final integration; 7 representative layout validation; 11 report-quality acceptance.
- **Can other work continue?** Yes: scoring, report schema, mocked provider/error handling, input provenance and PDF fixtures. Real production AI is not complete without approval. The report's sections, regeneration capability and server-only OpenAI boundary are already resolved.

## D09 — Funnel counting and attribution

- **Question:** For each of the six funnel steps, are counts unique visitors/users, sessions or entity/event totals? Define reporting window/cohort, anonymous-to-user association, repeat visits/diagnostics/regenerations, conversion denominators and reporting timezone.
- **Why necessary:** P §30 specifies the six steps and suggested events but not these counting semantics. Different plausible aggregations give different funnel values. A requires minimal, privacy-aware event handling.
- **Affected stages:** 10; analytics-linked totals in 9 if reused.
- **Can other work continue?** Yes: all core diagnostic/report work and event schema scaffolding. Do not publish guessed conversions; resolve D02 before persistent anonymous tracking.

## D10 — Consultation validation and administrator notification

- **Question:** Which lead form fields are required, and what valid phone/Telegram input is accepted? Which notification channel/provider and controlled administrator destination must receive new leads?
- **Why necessary:** P §27 lists the fields and mandates a notification, but supplies neither validation/cardinality details nor a channel/recipient. A's email discussion concerns report delivery and does not supply a consultation destination.
- **Affected stages:** 8; 11 complete MVP path.
- **Can other work continue?** Yes: report/Dashboard and lead persistence/outbox structure. A synthetic notification adapter can test failures, but actual delivery cannot be declared complete without its destination/transport. Report email remains optional and is not this decision.

## D11 — Feedback cardinality and required fields

- **Question:** Is the permitted feedback one per user/company, one per completed diagnostic, or repeatable? Can an existing submission be edited? Are rating/useful/improve all required or only some?
- **Why necessary:** P §§2.1.15, 26 specifies eligibility after one completed diagnostic, rating 1–5 and two text questions, but only says the CTA may be hidden after feedback. It does not establish a database uniqueness rule or edit/requiredness policy.
- **Affected stages:** 8 form/constraints; 9 count/average correctness.
- **Can other work continue?** Yes: eligibility check, popup layout, other flows and read-only admin layout. Do not invent per-diagnostic linkage or repeat-submission behavior. Optional beta wording feedback is not mandatory scope.

## D12 — Branded PDF assets and overflow acceptance

- **Question:** Provide the official red iTeam logo asset required in the PDF/UI. Is eight A4 pages a strict limit for all valid report content, and what approved treatment applies when required content does not fit: content-length constraints/retry, controlled layout adjustment, or permitted extra pages?
- **Why necessary:** P §§24, 39 specifies color/style and an eight-page format while requiring long-text wrapping with no truncation or blank extras. Neither document supplies the logo or resolves overflow for variable 1000–1500-word reports. Do not invent a logo, cut sections or silently change page count.
- **Affected stages:** 1 final branding, 7 PDF acceptance; 6 if prompt length constraints need refinement.
- **Can other work continue?** Yes: landing without invented branding, renderer deployment spike, template and synthetic typography tests. Exact library selection is an engineering spike per A, not another product question.

## D13 — Admin date and aggregate semantics

- **Question:** Which timestamp is the displayed/filterable “diagnostic date” (start or completion), which timezone applies, and does “latest index” refer to the latest successfully scored diagnostic if a newer unfinished one exists? Do headline “Received report” and “Left feedback” counts represent unique users or record totals?
- **Why necessary:** P §§25, 28–29 asks for these dates/latest values/counts without their precise definitions. A stores separate timestamps and requires explicit timezone semantics. Query implementation must not substitute one interpretation invisibly.
- **Affected stages:** 8 history display; 9 admin aggregates/filters; 10 if sharing definitions.
- **Can other work continue?** Yes: underlying dated records, explicit started/completed fields and list/detail layout. Final ambiguous labels/counts await a decision.

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
