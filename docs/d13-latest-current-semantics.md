# D13 — Latest/current semantics

Status: **CLOSED**.

## Decisions

- There is no global current diagnostic. A company can have one active `in_progress` attempt; completed attempts are history. Resume uses the exact diagnostic ID and persisted block.
- Completed history is sorted by `started_at DESC` for presentation only. A future “latest completed” summary, if needed, means `status = completed` with `completed_at IS NOT NULL`, ordered by `completed_at DESC, id DESC`.
- For a specific diagnostic, the usable AI report is the highest-version report with `status = completed`. Newer `failed` or `generating` versions do not hide an older completed report. Without a completed version, the UI shows the persisted process state and no report content.
- The current editable company profile is `company_profiles`. A completed diagnostic reads its immutable `diagnostic_company_snapshots.profile_data`; if absent, it shows “Исторический профиль компании недоступен”. An unfinished diagnostic may temporarily fall back to the current profile.
- PDF artifacts and report email records stay explicitly bound to their report/version/artifact. No implicit latest selection is used for these flows. Leads and feedback remain explicit historical records.
- Admin history ordering is presentation ordering, not a current/latest business definition.

No runtime data, migrations, or analytics events were changed by this decision.
