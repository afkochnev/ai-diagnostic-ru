# Individual prompt revisions

`ai_reports.version` is the generation sequence for one diagnostic. It controls history ordering, unique version allocation and the `ai_report_vN` job key.

A new initial or regenerated report for a diagnostic pinned to `manageability` methodology version 5 stores prompt `RU-1.6` and input `individual-ru-1.6`. The new input drops blank answers, orders substantive answers by questionnaire position and tags each answer with the question, block and purpose. It carries block scores and preserves tied rankings. Numeric answers to individual questions are outside this input contract. Earlier methodologies use `RU-1.5` for new generations.

The worker dispatches by the prompt version saved on the report row. `RU-1.6` replays the saved input on its initial execution and automatic retries. `RU-1.0` through `RU-1.5` retain their previous input rebuilding and prompt assets. An unsupported prompt or a missing version marker for a new input fails before the provider call. Existing rows are retained. Regeneration puts the new generation in its own row.

The structured output stays on `RU-1.0`. Completed-report views read the stored output. PDF artifacts use report ID, report generation and PDF template version. Regeneration creates a separate PDF identity while earlier PDFs remain readable. For a recoverable provider failure, the job schedules a retry and the report remains queued until the next attempt. When retries are exhausted, the report moves to failed.
