# V2.7 — YooKassa production capability and configuration

This package implements production-mode contracts in code and SQL. It does not enable billing or authorize any production mutation. The commercial authority remains `docs/v26b-commercial-config.json`: 480 RUB / 48000 minor, one calendar year, one-time payment, no recurring or auto-renewal, no VAT (`vat_code=1`), `productionEnabled=false`. The approved commercial/privacy body bytes are unchanged.

## Canonical staging baseline

PR #9 was merged by explicit owner authorization. Main/merge SHA is `9823b3f7b619b22137c0c9626714b627e36207b3`; its tree equals the accepted PR head `8c76de6`. Only that merge SHA is deployed on staging. The subsequent production-capability branch is a separate review candidate and is not automatically merged or deployed. Production remains on its pre-existing app/DB.

## Test/live boundary

The test path accepts only the exact staging app/project pair, or a non-production loopback pair, with `YOOKASSA_TEST_MODE=true` and a test-format key. The production path requires `NODE_ENV=production`, exact `https://audit.iteam.ru` / `https://fhvxqeaujjeiflanqsbg.supabase.co`, `YOOKASSA_TEST_MODE=false`, a live-format key, numeric shop ID, and `YOOKASSA_PRODUCTION_CONFIRMED=true`. No environment override changes price, term, VAT or the authoritative production OFF switch.

Actual payment creation additionally requires the authoritative `productionEnabled=true` in a separately approved future version, `BILLING_ENABLED=true`, and confirmed production fiscal settings. None of those production activation changes is made now. `YOOKASSA_PRODUCTION_FISCAL_CONFIRMED=true` is independent from the previously accepted TEST receipt settings; copying TEST flags does not confirm a production configuration.

Every production create checks GET `/me` first: exact merchant, `test=false`, enabled store, issuer INN `7703381761` and fiscalization enabled. This GET does not confirm `payment_mode`, measure or USN subtype. On 2026-10-23 the owner confirmed the actual production shop/receipt solution and `payment_mode=full_payment`, `measure=another`; no independent accountant approval or remote API verification is claimed. The helper returns only a safe projection and is also available for a future explicitly authorized read-only merchant preflight. No real merchant request was executed in this phase.

The application's persisted checkout flag must match its runtime mode before any payment HTTP request. Authenticated GET `/payments/{id}` must match that flag, merchant, bound ID, amount/currency and all metadata before financial processing. A test payment cannot activate a live checkout, and vice versa. Webhooks remain ID hints; a browser return grants no access.

## Database configuration

The additive readiness migration introduces `yookassa_test_mode=true`, `yookassa_live_approved=false`, `yookassa_reconciliation_enabled=false`. It does not activate an offer or assign a merchant. Existing test configuration is preserved. Live creation or reconciliation requires explicit DB live approval and a matching-mode offer. A referenced offer's terms, identity and test/live flag cannot be rewritten; do not convert an offer already used by old checkouts.

An independent DB reconciliation flag permits verification of existing bound payments when new creation is paused. New purchases remain denied. Receipt status, annual activation/renewal and full refunds use the same stored merchant/mode checks. The original immutable legal acceptance, annual history, duplicate handling, expiry gates and data-preservation contract remain in force.

## Confirmed staging/test shop

The owner confirmed on 2026-10-23 that `shopId=1504416` is the AI Company Audit **test** shop bound to `https://ai-diagnostic-staging-web.onrender.com`, with receipt-checking mode enabled. This is owner-provided test evidence, not an independent production merchant/fiscal verification. The Online cash register screen from that test shop does not establish what receipt solution a future production shop will use. No TEST settings are copied to production.

## Owner-confirmed production configuration

On 2026-10-23 the owner confirmed from the working YooKassa cabinet of ООО «АйТим Менеджмент»: production `shopId=1079713`, API protocol connection, **Receipts from YooKassa**. This supersedes the earlier unconfirmed status. The separate TEST shop remains `1504416`.

Prepared slots in `docs/v27-production-configuration.json` now record `YOOKASSA_RECEIPT_SOLUTION=yookassa`, receipt configuration/mode/production fiscal confirmation flags `true`, `payment_subject=service`, `payment_mode=full_payment`, `measure=another`, required measure `true`, `vat_code=1` and 480.00 RUB. These are owner-confirmed settings, not installed production environment values. The authoritative commercial contract still has `productionEnabled=false`; all creation, reconciliation and refund initiation switches stay OFF. No production secret is present or requested.

For this receipt solution, `YOOKASSA_RECEIPT_REQUIRES_TAX_SYSTEM_CODE=false`; `YOOKASSA_TAX_SYSTEM_CODE` stays unset and is absent from receipt payloads. No USN subtype/code is inferred. The invalid API measure `other` is rejected before HTTP.

Run `node --import tsx scripts/billing-production-readiness.ts` for offline **configuration** readiness: `V27_PRODUCTION_CONFIGURATION_READY` means the agreed non-secret profile is validated while billing and installation remain OFF. The nested runtime report intentionally still shows the missing live secret and disabled commercial/billing switches. No secret is read from process.env, and no network or write occurs.

## Staging acceptance preparation and future rollout

The exact preparation is in `docs/v27-staging-acceptance-plan.json`. It is a plan only. No new staging migration or deploy is executed in this configuration-confirmation step. Staging must retain TEST shop `1504416`, TEST credentials and `YOOKASSA_TEST_MODE=true`; production shop/flags/credentials must never be copied into staging. Real YooKassa calls, new payments/refunds, emails and AI are outside this acceptance plan.

After separately authorized staging acceptance, review/canonicalize PR #10 before any production rollout. Refresh the exact production migration inventory, compatibility/backup/containment package and runtime configuration against that final canonical candidate. The previous read-only inventory has 30 applied entries and 21 pending migrations in the 51-file candidate; it is not a fresh cloud check or permission to apply.

Production Auth, environment, DB, legal registry, feature flags, merchant webhook, app/worker and authoritative `productionEnabled` require separate authorization. After authorized protected installation, perform read-only GET `/me` with creation still OFF. A bounded real-money payment/refund smoke remains a separately approved action. The current `V27_PRODUCTION_CONFIGURATION_READY` status makes no claim that production is installed or financially accepted.

## Validation

Fake-HTTP tests cover a future-authorized live contract in memory while the actual commercial JSON stays OFF. Networkless SQL tests cover both modes, disabled defaults, rollback/preservation, private grants, wrong-mode offers, immutable used offers, in-flight reconciliation with new creation OFF, yearly renewal, duplicate/concurrent events, receipt state, full-refund downgrade, later repurchase and Admin Billing projection. Full existing test/mock suites remain required.

References: [official OpenAPI](https://yookassa.ru/developers/api/yookassa-openapi-specification.yaml), [testing and live transition](https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing), [webhook verification](https://yookassa.ru/developers/using-api/webhooks). These sources describe provider contracts; they do not establish this merchant's confirmed production fiscal settings.
