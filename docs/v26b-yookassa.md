# V2.6B — YooKassa, local implementation

`docs/v26b-commercial-config.json` is the commercial authority. Its approved offer is one payment of **480 RUB**, **48000 minor units**, for **one calendar year** of Account Advanced. No auto-renewal, recurring charge or saved payment method. The sale is without VAT (`vat_code=1`); no VAT amount is calculated. Price, currency, description, quantity, subject and VAT code are not accepted from the browser or environment.

## Current boundary

Only local/fake-HTTP acceptance is authorized. `productionEnabled=false`, the adapter rejects production origins and live secret formats, the DB YooKassa gate defaults off, and the approved sandbox offer is inserted as draft. No existing billing configuration, plan or historical row is reassigned. No staging apply, deployment, sandbox payment, real credential use or production change is part of this implementation.

`BILLING_PROVIDER=mock` keeps the accepted V2.6A behavior. `BILLING_PROVIDER=yookassa` selects the new adapter only with explicit billing enablement, the exact staging app/project pair or nonproduction loopback pair, `YOOKASSA_TEST_MODE=true` and sandbox-format configuration. Feature checks continue to read local committed Account subscriptions and entitlements; they never call YooKassa.

## Payment and verification

An authenticated, verified Account owner reserves a checkout in the database with the checked Company UUID, offer, merchant identity and test flag. An active pending checkout is reused. Its persisted UUID is the YooKassa idempotency key, and its metadata links checkout, Account and offer. The receipt email comes from the verified Auth identity, not browser JSON. External HTTP runs outside the Account lock.

The adapter uses Basic Auth only against the fixed `https://api.yookassa.ru/v3/` origin, rejects redirects, limits response bytes/time, validates the create response, and binds only the returned payment ID. No payment object, card information, receipt body, email, authorization header or credential is stored in the billing journal. An ambiguous create is retried with the same checkout/key only inside a conservative 23-hour window. After that, it requires reconciliation; a new key is never silently generated for an unknown operation. Merchant receipt settings and the verified payer email must remain consistent while retrying a pending creation.

`POST /api/billing/create-payment` rejects unknown fields, browser-controlled price/offer/return URL, foreign Accounts, CSRF origin mismatch and unauthenticated callers. The existing server action uses the same orchestration. The only external redirect is a validated HTTPS confirmation URL from the provider; internal returns are fixed routes containing a checkout UUID.

`POST /api/billing/webhook/yookassa` treats the notification as an untrusted payment-ID hint. YooKassa does not use the mock HMAC format. Every notification, and the owner's return/recheck path, performs an authenticated **GET /payments/{id}** before any activation. The retrieved payment must match the bound payment ID, merchant, test flag, exact amount/currency and all checkout/Account/offer metadata. `pending` and `waiting_for_capture` never activate. Success requires `status=succeeded`, `paid=true` and a valid capture timestamp. A terminal create response also requires this independent GET before financial processing. A payment with any refunded amount is not used to grant new access; subsequent refund entitlement decisions remain a separate policy, not an automatic revocation rule.

Only a verified normalized result reaches the service-only event RPC. The existing immutable event/attempt/audit tables are reused. The event identity is derived from payment ID and terminal status; its hash is derived from the canonical verified projection, not notification bytes. Unknown/unbound payments and transient verification errors are retryable; the handler never acknowledges durable financial success before the transaction completes. Rate limits and streaming body limits bound unauthenticated work. No forwarded IP header is accepted as payment proof.

## Annual access and renewal

One committed successful payment causes one Account-locked transition. A calendar year in UTC is added to `max(current time, existing YooKassa paid-until)`; early explicit renewal keeps all remaining paid time. The prior product row is ended without rewriting its original paid-through date, a new immutable annual product row is inserted, and exactly one active product subscription remains. Separate paid purchases serialize and retain both years; duplicate notifications for one purchase retain only one year. An intentional manual Advanced → provider transition is supported. A different active provider requires reconciliation, not silent replacement.

Expiry is enforced immediately by the existing `effective_account_plan()` timestamp check, independently of worker/provider availability. The bounded service-only `billing_expire_yookassa_entitlements(100)` can reconcile expired rows, restore an explicit Free row and append an audit event; it is idempotent and skips locked Accounts. No worker redeployment or new scheduler is required for feature denial. This release does not schedule the cleanup on staging.

Existing Companies, Teams, invited participants, results, reports and PDF remain accessible under the accepted downgrade contract. New paid expansion is denied. Browser return parameters cannot grant access; the return UI rereads committed local state after verification, retains the original Company and provides a safe explicit recheck. It shows the paid-until date and no-auto-renewal wording. Admin Billing adds YooKassa filtering, amount/currency and annual dates, distinguishes annual access from a real recurring subscription, and keeps unsafe manual overrides blocked.

## Receipt configuration gates

`payment_mode` has no default. It must be set from the actual YooKassa/fiscal configuration and explicitly confirmed **before any sandbox payment**. Receipt solution confirmation is also required. Tests use fake configuration and transport only; their sample mode is not merchant approval.

USN is known; its subtype is not. Do not infer `tax_system_code` from VAT, amount or USN. If the selected receipt solution does not require the application to send this code, omit it. If required, use only the merchant/accountant-confirmed USN code. Its absence is not an unconditional implementation blocker. The selected receipt solution may also require a confirmed measure; this is configurable, with no guessed default. The YooKassa receipt solution requires a measure and does not require `tax_system_code`.

VAT code confirmation is resolved. Remaining rollout gates are actual receipt/payment-mode confirmation, sandbox credentials and separately authorized sandbox E2E, approved merchant/commercial/legal configuration and separate production authorization. No refund or cancellation business policy has been invented.

## Verification and migration

Run `npm run lint`, `npm run typecheck`, `npm run test:unit`, the build with the repository's non-secret CI placeholders, and `python3 scripts/test-v24-ci.py`. The SQL runner creates only named disposable containers with no network. It runs the new annual-access suite, all accepted V2.6A cases **after** the new migration, and the historical/Account/Team/V2.3/V2.4/V2.5 regression suites. It removes only containers it created.

Before any future staging apply, compare the live migration ledger and perform an exact `db push --dry-run` using the accepted historical timestamp alias with unchanged SQL bytes. Expected pending set: only `20261021164251_yookassa_annual_billing.sql`. Stop on any extra historical migration; do not repair or use include-all. A dry-run does not authorize application or deployment in this task.

Official references:

- [YooKassa webhook verification](https://yookassa.ru/developers/using-api/webhooks)
- [Idempotency and the 24-hour provider window](https://yookassa.ru/developers/using-api/interaction-format)
- [Current official OpenAPI specification](https://yookassa.ru/developers/api/yookassa-openapi-specification.yaml)
- [Fiscal parameter values](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/other-services/parameters-values)
