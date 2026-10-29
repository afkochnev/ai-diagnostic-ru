# Individual prompt revisions

`ai_reports.version` is the generation sequence for one diagnostic. It controls history ordering, unique version allocation and the `ai_report_vN` job key. It never selects a prompt.

Every newly enqueued row persists `CURRENT_INDIVIDUAL_PROMPT_VERSION` (`RU-1.3`). Initial v1 and regenerated v2/v3 therefore use the same current prompt. Existing rows are not backfilled. Historical prompt assets RU-1.0 through RU-1.3 remain unchanged.

The worker selects the persisted `prompt_version` and passes it explicitly to `generateReport`. Both boundaries allow only RU-1.0, RU-1.1, RU-1.2 and RU-1.3. Missing or unsupported values fail closed with `invalid_individual_prompt_version`, without loading AI input or calling the provider; no fallback or prompt rewrite occurs. `generateReport` has no default prompt argument.

Regression tests execute scoring-to-enqueue, failed-report recovery, next-version concurrency, historical persisted-version dispatch and the actual prompt-asset loader with a mocked OpenAI transport. No methodology, prompt text, scoring, schema or PDF template change is required.
