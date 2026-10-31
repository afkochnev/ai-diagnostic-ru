# Team entry and test access

The Team entry button preserves the selected Company. Free owners go to the
Account plan page, where they can choose Advanced or enter a testing promo code.
Successful activation returns to that Company's Team creation form.

## Promo codes

Administrators issue codes at `/ru/admin/promos`. Each activation grants Advanced
for 30 days. A code has a campaign label, a redemption deadline and an activation
limit. New codes remain visible and copyable in the administrator list. The
display value is encrypted with AES-256-GCM under a domain-separated key derived
from the existing `AUTH_FLOW_SECRET`; redemption still uses the SHA256 hash.
Keep this server secret stable. Codes issued before the display migration have
no recoverable display value and show a legacy notice; no code is guessed or
silently replaced.

Revoking a code stops new activations and preserves grants already issued.
Deleting a code also stops new activations and removes it from the administrator
list. It archives the record so grants, redemption history and retry behavior
remain intact. The administrator confirms deletion in the card. A code can be
used only once per Account; retries do not extend
the original expiry. Existing Advanced and provider-managed billing state are
preserved. No live code is seeded by a migration.

An administrator with an enrolled second factor must complete their existing
MFA challenge before opening the owner workspace. The promo does not enroll or
enable MFA. The challenge returns to the selected Account/Company plan page;
promo codes never travel in the redirect URL. Ordinary owners without MFA do
not receive an administrator challenge.

## Release

The initial Team release uses the two 20261031 migrations. `team_product_release.enabled` starts
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

The administrator display/delete update adds
`20261031180515_advanced_promo_admin_management.sql` before deploying the new WEB.
It preserves the previous four-argument create RPC during the rollout. New WEB
passes the encrypted display value explicitly. It does not issue, redeem,
archive or replace any live code during migration.

## Focused local verification

`python3 scripts/test-advanced-promo-local.py` uses a disposable local PostgreSQL
cluster over a Unix socket and never reads remote credentials. PostgreSQL
`initdb`, `pg_ctl` and `psql` must be available on PATH.

`python3 scripts/test-team-product-local.py --container <local-supabase-db>`
uses a disposable database inside one of the explicitly allowed local Supabase
containers. It checks normal creation, invitations, participant privacy,
aggregation, versioned reports and PDF storage, plus historical job isolation.
