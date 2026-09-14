# Stage 9C — Worker / Job Lifecycle

Supported job kinds are `score_diagnostic`, `ai_report`, and `consultation_notification`. Claims are performed by service-role RPCs using `FOR UPDATE SKIP LOCKED` and an atomic update. A claim sets `running`, increments `attempts`, creates a lease token, and sets a five-minute lease. Completion and failure updates are fenced by that token; expired running jobs are reclaimable while active leases are not.

Scoring and AI allow three attempts; consultation allows five. Retryable failures receive exponential backoff (starting at 30 seconds, capped at one hour). Deterministic missing input, malformed AI job keys, missing report rows, and other non-retryable failures are terminal. Terminal failures remain `failed` with `available_at = 2099-01-01T00:00:00Z`; claim SQL requires `attempts < max_attempts`, so the sentinel is an operational marker rather than a future execution time. The queue summary reports retryable versus terminal failures and expired leases.

The worker runs one polling loop, remains alive when idle, and stops polling after SIGTERM. Per-job failures are handled by handlers and do not intentionally terminate the process; fatal boot/claim errors exit non-zero for supervisor restart. Malformed AI job keys and missing report rows are now fenced terminal failures instead of silently defaulting to version 1 or remaining claimable.

Provider and diagnostic errors persisted in job records are classified into safe codes and generic messages. Logs retain job identity, kind, attempt, transition, and duration without prompts, answers, credentials, tokens, or raw provider responses. Existing uniqueness constraints and idempotent result/report writes protect replay windows; provider exactly-once delivery remains outside this lifecycle guarantee.

Operational recovery: inspect the queue summary by kind, verify lease expiry and attempt ceiling, review safe error codes, and retry only jobs below the configured ceiling. After a database restore, review external-side-effect jobs manually before replaying them. Historical queue retention/archive remains a future operations decision; no destructive cleanup is performed here.
