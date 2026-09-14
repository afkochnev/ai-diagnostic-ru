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

## Stage 9E.1 — External alerting baseline

The minimum production setup uses platform/uptime notifications rather than
application polling or a custom metrics service. The web monitor target is
`GET https://<production-web-host>/api/health`; the current staging target is
`https://ai-diagnostic-staging-web.onrender.com/api/health`. The request is a
public HTTPS GET with no authentication header and no query secret. A monitor
should run every 60 seconds, alert after three consecutive non-200 responses or
timeouts (about three minutes), and send a recovery notification. TLS
certificate validation remains enabled.

Render service notifications are the preferred signal for web deploy/crash or
restart events and for a background-worker fatal exit/restart. The operator
must confirm that email or the selected integration is available for the
account/plan. If worker service notifications are unavailable, the web uptime
monitor still covers the web process, while worker failures remain visible in
Render worker logs and queue diagnostics; adding a database heartbeat is a
future option and is not part of this baseline.

Minimum launch alerts are: sustained `/api/health` failure, repeated web
crash/restart, and repeated worker crash/fatal exit. Queue age, terminal-failure
spikes, provider-failure spikes, database failures, and infrastructure-caused
429 spikes are recommended follow-up alerts. The alert destination must be a
shared owner-controlled mailbox or operations integration; no destination or
secret is embedded in application source.

### Manual production configuration checklist

1. Select one shared human-visible destination (operations mailbox, Slack, or
   equivalent) and assign an owner and escalation backup.
2. Create an HTTPS uptime check for the production `/api/health` URL using
   `GET`, 60-second interval, three consecutive failures, TLS validation, and
   recovery notification. Keep the staging URL as a non-production check if
   desired.
3. In Render notification settings, enable service/deploy failure and
   crash/restart notifications for the Web Service. Confirm delivery with a
   reversible test supported by the account; do not create an outage merely to
   test it.
4. Enable the equivalent notifications for the Render Background Worker,
   including fatal boot/configuration failure and repeated restart where the
   account exposes those events. Confirm delivery and record any plan
   limitation.
5. Link the alert destination to the read-only queue SQL/operational summary.
   The operator response should inspect oldest queued age, stale leases,
   retryable failures, terminal failures, and recent safe error codes.
6. Record monitor owner, escalation timing, Render service names, and the
   production URL in the operations runbook. Do not place credentials in the
   repository.

This baseline requires no application code change, separate readiness endpoint,
heartbeat writes, paid observability SDK, or custom monitoring infrastructure.
Job retention and `rate_limit_windows` retention are not launch blockers at
the expected volume. Review both table sizes monthly and introduce a tested,
operator-controlled retention procedure before growth affects query/index
performance (for example, sustained six-figure row counts or measurable query
latency).
