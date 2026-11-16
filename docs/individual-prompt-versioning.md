# Individual prompt revisions

`ai_reports.version` is the generation sequence for one diagnostic. It controls history ordering, unique version allocation and the `ai_report_vN` job key.

A new initial or regenerated report for a diagnostic pinned to `manageability` methodology version 5 stores prompt `RU-1.8` and input `individual-ru-1.6`. This input drops blank answers, orders substantive answers by questionnaire position and tags each answer with the question, block and purpose. It carries block scores and preserves tied rankings. Numeric answers to individual questions are outside this input contract. Earlier methodologies use `RU-1.7` for new generations. Both new prompts address the reader directly in Russian.

The worker dispatches by the prompt version saved on the report row. `RU-1.6` and `RU-1.8` replay their saved input on initial execution and automatic retries. The other supported revisions rebuild the legacy input. An unsupported prompt or a missing input version marker fails before the provider call. Each generation keeps its own row and prompt asset.

The structured output stays on `RU-1.0`. Completed-report views read the stored output. PDF artifacts use report ID, report generation and PDF template version. Regeneration creates a separate PDF identity while earlier PDFs remain readable. For a recoverable provider failure, the job schedules a retry and the report remains queued until the next attempt. When retries are exhausted, the report moves to failed.
