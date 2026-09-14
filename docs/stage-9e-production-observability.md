# Stage 9E — Production Observability

`GET /api/health` is a static liveness endpoint returning `{ "status": "ok" }`. It performs no database or provider call and exposes no configuration. Readiness is separate: Render process status plus worker queue/DB polling logs are used to identify dependency failure without making liveness fragile.

The worker has one long-running process. Boot or claim configuration failures exit non-zero for supervisor restart; ordinary per-job failures are handled by handlers. Safe structured events include job id, diagnostic/report id where needed, kind, attempt, transition, and safe error code. SIGTERM is logged by process lifecycle and stops the polling loop. Queue visibility is provided by the server-side operational summary helper, which reports counts by kind, queued age, running jobs, expired leases, retryable failures, and terminal failures.

Operational read-only SQL should be run by an authorized operator against staging/production:

```sql
select kind, status, count(*)
from public.jobs
group by kind, status
order by kind, status;

select id, kind, diagnostic_id, attempts, lease_expires_at, created_at
from public.jobs
where status = 'running' and lease_expires_at <= now()
order by lease_expires_at;

select id, kind, diagnostic_id, attempts, last_error_code, completed_at
from public.jobs
where status = 'failed'
order by completed_at desc nulls last
limit 100;

select count(*) as rate_limit_window_rows,
       min(window_start) as oldest_window,
       max(window_start) as newest_window
from public.rate_limit_windows;

select id, diagnostic_id, version, status, created_at
from public.ai_reports
where status in ('generating', 'failed')
order by created_at desc;
```

Logs and client errors must not contain passwords, tokens, cookies, service-role keys, provider keys, TOTP secrets, raw prompts/responses, free-text answers, report bodies, or filesystem paths. API errors use stable safe codes. Alerts should cover web unavailable, worker restart/fatal boot, oldest queued thresholds (scoring 2m, AI 5m, consultation 5m), expired leases, terminal failures, repeated provider failures, DB failures, and infrastructure-caused 429 responses.

Rate-limit windows and completed jobs currently have no automatic destructive cleanup. At pilot scale this is acceptable, but production must define retention before growth materially affects indexes. Review queue and rate-limit row counts monthly and archive only with a tested, operator-controlled procedure. After restore, inspect external-side-effect jobs before replaying them.
