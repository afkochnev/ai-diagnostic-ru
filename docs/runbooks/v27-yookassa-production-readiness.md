# V2.7 — YooKassa production capability and configuration

This package implements production-mode contracts in code and SQL. It does not enable billing or authorize any production mutation. The commercial authority remains `docs/v26b-commercial-config.json`: 480 RUB / 48000 minor, one calendar year, one-time payment, no recurring or auto-renewal, no VAT (`vat_code=1`), `productionEnabled=false`. The approved commercial/privacy body bytes are unchanged.

## Canonical staging baseline

PR #9 was merged by explicit owner authorization. Main/merge SHA is `9823b3f7b619b22137c0c9626714b627e36207b3`; its tree equals the accepted PR head `8c76de6`. Only that merge SHA is deployed on staging. The subsequent production-capability branch is a separate review candidate and is not automatically merged or deployed. Production remains on its pre-existing app/DB.

## Test/live boundary

The test path accepts only the exact staging app/project pair, or a non-production loopback pair, with `YOOKASSA_TEST_MODE=true` and a test-format key. The production path requires `NODE_ENV=production`, exact `https://audit.iteam.ru` / `https://fhvxqeaujjeiflanqsbg.supabase.co`, `YOOKASSA_TEST_MODE=false`, a live-format key, numeric shop ID, and `YOOKASSA_PRODUCTION_CONFIRMED=true`. No environment override changes price, term, VAT or the authoritative production OFF switch.

Actual payment creation additionally requires the authoritative `productionEnabled=true` in a separately approved future version, `BILLING_ENABLED=true`, and confirmed production fiscal settings. None of those production activation changes is made now. `YOOKASSA_PRODUCTION_FISCAL_CONFIRMED=true` is independent from the previously accepted TEST receipt settings; copying TEST flags does not confirm a production configuration.

Every production create checks GET `/me` first: exact merchant, `test=false`, enabled store, issuer INN `7703381761` and fiscalization enabled. This GET does not confirm `payment_mode`, measure or USN subtype; those remain confirmed merchant/accounting inputs. The helper returns only a safe projection and is also available for a future explicitly authorized read-only merchant preflight. No real merchant request was executed in this phase.

The application's persisted checkout flag must match its runtime mode before any payment HTTP request. Authenticated GET `/payments/{id}` must match that flag, merchant, bound ID, amount/currency and all metadata before financial processing. A test payment cannot activate a live checkout, and vice versa. Webhooks remain ID hints; a browser return grants no access.

## Database configuration

The additive readiness migration introduces `yookassa_test_mode=true`, `yookassa_live_approved=false`, `yookassa_reconciliation_enabled=false`. It does not activate an offer or assign a merchant. Existing test configuration is preserved. Live creation or reconciliation requires explicit DB live approval and a matching-mode offer. A referenced offer's terms, identity and test/live flag cannot be rewritten; do not convert an offer already used by old checkouts.

An independent DB reconciliation flag permits verification of existing bound payments when new creation is paused. New purchases remain denied. Receipt status, annual activation/renewal and full refunds use the same stored merchant/mode checks. The original immutable legal acceptance, annual history, duplicate handling, expiry gates and data-preservation contract remain in force.

## Production inputs still required

Prepared slots are in `docs/v27-production-configuration.json`; they are not an env import and have not been installed. Keep all production creation/refund switches OFF.

1. Confirm the actual production shop ID and protected live key destination; do not reuse TEST credentials or overwrite an existing shop's webhook without verifying its consumers.
2. Confirm the production receipt solution, `payment_mode=full_payment`, measure if required, and fiscalization setup. USN subtype is not known. Omit `tax_system_code` when not required; send only an explicitly confirmed accounting code when required. Unknown subtype is not an unconditional implementation blocker.
3. Refresh the exact production migration inventory and compatibility/backup/containment package against the final canonical candidate. Current production has 30 ledger entries; this 51-file candidate has 21 pending migrations, including the historical timestamp alias, subject to fresh read-only verification.
4. Obtain separate authorization before changing production Auth, environment, DB, legal registry, feature flags, merchant webhook, app/worker or authoritative `productionEnabled`.
5. After authorized installation, perform read-only GET `/me` and verify merchant/fiscal configuration with creation still OFF. A bounded real-money payment/refund smoke is a separate action requiring its own approval.

Use `node --import tsx scripts/billing-production-readiness.ts` for an offline report of prepared slots. It reads no secrets from process.env and performs no network or writes. A locally valid slot report is not evidence that production is configured, deployed or financially accepted.

## Validation

Fake-HTTP tests cover a future-authorized live contract in memory while the actual commercial JSON stays OFF. Networkless SQL tests cover both modes, disabled defaults, rollback/preservation, private grants, wrong-mode offers, immutable used offers, in-flight reconciliation with new creation OFF, yearly renewal, duplicate/concurrent events, receipt state, full-refund downgrade, later repurchase and Admin Billing projection. Full existing test/mock suites remain required.

References: [official OpenAPI](https://yookassa.ru/developers/api/yookassa-openapi-specification.yaml), [testing and live transition](https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing), [webhook verification](https://yookassa.ru/developers/using-api/webhooks). These sources describe provider contracts; they do not establish this merchant's confirmed production fiscal settings.
