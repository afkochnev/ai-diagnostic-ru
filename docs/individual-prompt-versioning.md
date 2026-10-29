# Individual prompt revisions

`ai_reports.version` is the generation sequence for one diagnostic. It controls history ordering, unique version allocation and the `ai_report_vN` job key. It never selects a prompt.

Every newly enqueued row persists `CURRENT_INDIVIDUAL_PROMPT_VERSION` (`RU-1.4`). Initial v1 and regenerated v2/v3/vN therefore use the same current prompt. Existing rows are not backfilled or edited. Historical prompt assets RU-1.0 through RU-1.3 and schema RU-1.0 remain byte-for-byte unchanged.

The worker selects the persisted `prompt_version` and passes it explicitly to `generateReport`. Both boundaries allow RU-1.0 through RU-1.4. An exhaustive typed asset map selects the exact revision. Missing or unsupported values fail closed with `invalid_individual_prompt_version`, without loading AI input or calling the provider; no fallback or prompt rewrite occurs. `generateReport` has no default prompt argument.

RU-1.4 explicitly separates supplied diagnostic facts, respondent statements and locally labelled inferences throughout all 12 sections. Risks are conditional; diagnostic actions and expected results do not presume that unreported defects exist. Examples are generic and contain no customer data. Depth, numbers, Russian formatting and the existing JSON schema remain the contract.

Regression tests execute scoring-to-enqueue, failed-report recovery, next-version concurrency, retained-version dispatch and the actual asset loader with a mocked OpenAI transport. Historical asset/schema hashes are pinned. These tests establish routing and preservation, not real model quality. See [RU-1.4 acceptance](individual-prompt-ru-1-4-acceptance.md) for semantic staging review.

No methodology/scoring, schema, PDF template, Team/W2 or billing change is included. Activation in production requires a separately authorized release; a draft PR and staging acceptance do not authorize it.
