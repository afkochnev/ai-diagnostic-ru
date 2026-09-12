# Stage 7C consultation notification worker

The consultation request transaction only creates a `lead_requests` row, a
durable `jobs` row, and its delivery row. It never sends email synchronously.

`runPendingConsultationNotifications` is the single execution service used by
both launch paths:

- Local: `npm run worker:consultation -- --once` (or omit `--once` for a
  30-second loop). The command loads `.env.local` and calls the protected
  internal route.
- Production: schedule a POST to
  `/api/internal/workers/consultation` with the server-only
  `x-worker-secret` header. Set `INTERNAL_WORKER_SECRET` in the scheduler and
  application environments. No browser session is accepted.

The database claim function uses `FOR UPDATE SKIP LOCKED`, a lease token and a
five-minute expiry. Expired running jobs are reclaimable. Provider failures
clear the lease and schedule retryable jobs with exponential backoff; provider
4xx failures are terminal. A sent delivery and completed job are idempotent.

The existing local queued consultation job is intentionally not run during
automated checks. To perform one real retry after separately approving it:

```sh
npm run worker:consultation -- --once
```
