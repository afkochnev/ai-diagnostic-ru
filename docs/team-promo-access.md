# Team entry and test access

The Team entry button preserves the selected Company. Free owners go to the
Account plan page, where they can choose Advanced or enter a testing promo code.
Successful activation returns to that Company's Team creation form.

## Promo codes

Administrators issue codes at `/ru/admin/promos`. Each activation grants Advanced
for 30 days. A code has a campaign label, a redemption deadline and an activation
limit. Copy the full code immediately after issuance: only its hash and a short
hint are stored. Revoking a code stops new activations and preserves grants
already issued. A code can be used only once per Account; retries do not extend
the original expiry. Existing Advanced and provider-managed billing state are
preserved. No live code is seeded by a migration.

## Release

Apply the two new migrations in order. `team_product_release.enabled` starts
false; applying migrations alone does not open production Team access.

After explicit approval for production, enable the ordinary Team release with
the service-role RPC `activate_team_product_access()`. It checks that no live
controlled run/effect or ordinary job lease is in flight, then enables the DB
product, creation and invitation flags atomically. Expired historical rows are
left intact and do not block new Team diagnostics.

Configure WEB and WORKER with `TEAM_ENABLED=true`, `TEAM_PRODUCT_ENABLED=true`
and `TEAM_AI_PROVIDER=openai`. WEB must also allow creation and invitations
(`TEAM_CREATION_ENABLED=true`, `TEAM_INVITATIONS_ENABLED=true`) and use the
existing configured invitation mail provider. WORKER uses its existing OpenAI
credentials. The exact production origin and Supabase project must match the
existing launch configuration. Billing and acquisition flags need no change.

The ordinary worker excludes historical controlled Teams and tagged jobs.
Existing Team histories and Individual RU-1.5 remain unchanged.

## Focused local verification

`python3 scripts/test-advanced-promo-local.py` uses a disposable local PostgreSQL
cluster over a Unix socket and never reads remote credentials. PostgreSQL
`initdb`, `pg_ctl` and `psql` must be available on PATH.

`python3 scripts/test-team-product-local.py --container <local-supabase-db>`
uses a disposable database inside one of the explicitly allowed local Supabase
containers. It checks normal creation, invitations, participant privacy,
aggregation, versioned reports and PDF storage, plus historical job isolation.
