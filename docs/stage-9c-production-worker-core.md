# Stage 9C — Production worker core

Status: **ACCEPTED** after local DB-backed operational tests and full manual
worker retest (mock providers, isolated fixtures, no production side effects).

### Standalone Node boundary (Stage 9C.1)

The worker entry point is a plain Node runtime boundary. Runtime-neutral
configuration and service-role Supabase access live under `src/server-runtime/`;
worker handlers use those modules and do not import `server-only`, Next request
APIs, React or Server Actions. Next.js web adapters remain protected by
`server-only` and continue to use request-bound clients where required. The
worker is therefore started directly with `npm run worker`, without a shim,
module alias or patched dependency.

Stage 9C introduces one long-running Node process (`npm run worker`; `.env.local`
is loaded when present) using the
existing Postgres `jobs` table. Scoring, AI reports and consultation
notifications are handled by explicit job kinds. Scoring and AI claims use
atomic `FOR UPDATE SKIP LOCKED` functions with five-minute leases, expiry
reclaim, lease-token fencing and bounded attempt ceilings (3 each); consultation
uses the existing claim function with a five-attempt ceiling.

The scoring status endpoint no longer executes privileged scoring. It only
returns the owner-scoped diagnostic state; the worker performs execution. The
result page AI poll endpoint is a read-only owner-scoped status endpoint and
never calls OpenAI or enqueues a report.

Pilot defaults are a two-second poll interval, one process, one concurrent job
per kind, and a 180-second OpenAI provider timeout. Retryable failures use
bounded exponential backoff (30 seconds to one hour); terminal failures are
represented by `failed` with attempts at the configured ceiling. Provider
exactly-once execution is not claimed: a crash after an external response and
before persistence can still cause a repeated provider call.

Report email and PDF preparation remain synchronous and are intentionally
outside this stage. No rate-limit system, analytics, or new provider is added.
Operational summary helpers expose queue, running, retryable/terminal failure,
oldest queued and expired-lease counts to trusted server-side operations.

D07 remains implementation-in-progress until the production runner is deployed
and the operational/manual checks, provider budgets, scheduler, recovery and
hosting decisions are accepted. No runtime jobs or provider calls were run
during implementation validation.
