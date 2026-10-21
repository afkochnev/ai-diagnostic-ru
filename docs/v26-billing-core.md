# V2.6A billing core

Account remains the billing subject. Local `account_subscriptions` and existing entitlement RPCs remain the sole feature authority. Team and worker code do not import a payment adapter.

`BillingProvider` owns checkout creation and cryptographic verification. V2.6A implements only `MockBillingProvider`. Approved inputs for the future YooKassa adapter are recorded in [v26b-commercial-config.json](v26b-commercial-config.json); that commercial decision does not activate a real adapter. After reserving an owner-authorized checkout, the adapter creates an idempotent provider checkout; a service-only binding RPC commits selected safe references before the session becomes pending. External calls never run while holding the Account lock. An adapter returns a normalized event to the common `billing_process_verified_event` transaction. Real offer activation stays blocked pending commercial decisions, legal versions and a concrete adapter. The mock offer has no price, currency or billing period.

## Configuration and deployment

`BILLING_ENABLED` defaults off. `BILLING_PROVIDER=mock` is accepted only with the exact staging APP_URL and Supabase URL pair, or non-production loopback test pair. APP_URL is the canonical public app origin. Unknown providers, production origins, incomplete configuration and disabled billing fail closed for checkout. Existing local entitlement reads remain independent of billing configuration and provider availability.

The private DB configuration defaults mock off as an independent gate. Enable it only during authorized staging/local acceptance; production must keep it off. Both application and database gate must pass. Mock signature uses a domain-separated HMAC of the exact body and signed timestamp with the existing server-only AUTH_FLOW_SECRET. This is an explicit test format, not a real provider signature or credential. No new secret appears in tables or client bundles.

## Transactions and retry contract

Owner-only checkout starts lock Account, validate fresh membership/Account/offer and existing V2.5 continuation, expire stale pending sessions, and reuse an active checkout for the same owner and offer. Company IDs must belong to that Account and cannot override a different existing conversion intent. For diagnostics created before V2.5, the Team CTA also carries an explicit Company UUID to the Advanced screen. That screen resolves fresh owner access and Account membership; a conflicting existing acquisition intent fails closed. Failure/retry carries the same checked UUID, and checkout stores it using the existing DB ownership validation. This is route context, not a second durable upgrade-intent system. Only the constant team_create destination is stored; no client URL is accepted.

Verified events are serialized by provider event identity and Account lock. An immutable receipt is committed together with an immutable processing attempt. Successful plan, payment, checkout, provider lifecycle, financial audit and existing acquisition trigger execute in one savepoint. Unexpected transaction failure rolls back all these changes, records a safe retryable attempt and returns HTTP 503. A subsequent same-hash delivery retries the same immutable receipt. Permanent validation errors are durable and rejected. Conflicting event hashes never apply new state.

Repeated successful events are ignored. A terminal ended provider subscription cannot be resurrected by reordered success. Earlier lifecycle timestamps cannot overwrite newer state. Refund financial status is modeled without deciding whether it revokes product access. Failed renewal is recorded without inventing a grace period. Confirmed end closes only the linked active product subscription and restores Free. No Company, participant, result, report or PDF is deleted.

The existing subscription_history_guard is unchanged: only active→ended with effective_until and updated_at is allowed; historical identity, plan, source and provider references stay immutable. Both manual plan RPCs reject an active provider product subscription before touching history. A second guard rejects manual insertion while a provider financial subscription remains active/cancel_pending/payment_failed.

## Admin support and provider→manual

Admin read-only projections abbreviate customer and subscription references and show no raw payload. Existing role/session checks remain mandatory. Global Admin does not grant ordinary checkout ownership. Pagination and Account/plan/provider/subscription/payment/date filters are bounded.

Do not manually end a provider product row to override billing. Support must first inspect the provider's independent financial status, obtain the needed commercial/operational authorization, stop billing at the provider through a future adapter workflow, deliver and verify the terminal lifecycle event, and confirm local Free plus preserved history. Only then can the existing audited manual plan process be considered. V2.6A implements no destructive self-service cancellation or arbitrary override.

## Future V2.6B

The user has approved YooKassa, Advanced, a one-time payment of 480 RUB (48000 minor units) for one year, without auto-renewal or recurring payments. This sale is without VAT: `vat_code=1`, `YOOKASSA_VAT_CODE=1`, `vat_included=false`. Display “480 ₽”, optionally “Без НДС”; do not calculate or display a VAT amount. The receipt item and authoritative configuration are in [v26b-commercial-config.json](v26b-commercial-config.json). These are V2.6B inputs; historical V2.6A acceptance artifacts retain the decisions known at that acceptance.

iTeam uses USN. Its subtype and YooKassa `tax_system_code` remain unconfirmed and must not be inferred. Send that code only when required by the confirmed receipt solution, using confirmed merchant/accounting settings; otherwise omit it. Its absence is not an unconditional implementation blocker. Verify receipt `payment_mode` against the actual YooKassa/fiscal configuration before production real-money rollout. VAT code confirmation is no longer a production-readiness blocker.

The YooKassa adapter, verified payment-state handling and annual access are implemented locally in [V2.6B](v26b-yookassa.md). Sandbox configuration/E2E, receipt solution and payment-mode verification, any applicable refund flow, and remaining merchant/commercial/legal decisions still require completion. Do not redesign Account/entitlement/Team authorization. `productionEnabled=false`; production requires separate approval and resolution of temporary-ru-v1 and commercial legal blockers.
