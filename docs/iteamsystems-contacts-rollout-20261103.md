# Contacts on iteamsystems.com

Owner request, 2026-11-03: consultation notifications and current product contacts
use `alexander@iteamsystems.com`; public product links use
`https://audit.iteamsystems.com`.

## Prepared change

- Support, Advanced/refund contacts, public links and new PDF links use the new domain.
- Individual PDF template `stage12-1j` and Team PDF template
  `team-report-v3-dispersion-percent-v3` create separate artifacts; existing
  reports/PDFs remain unchanged and AI is not rerun.
- Four contact-only legal revisions are in `docs/legal/*-ru-v2.md`.
  Exact source/target digests are recorded in `iteamsystems-contacts-20261103.json`.
- The publication migration appends v2 documents and atomically switches active
  document pointers. Historical documents, consents and checkout evidence remain intact.
- Versioned legal pages display the current contact outside the immutable body,
  including when a user opens an older revision.

## Production rollout

Production settings are managed directly in Render; `render.yaml` keeps the
destination as a per-service setting. Preserve all other values and secrets.

1. After owner release approval and passing CI, merge the PR.
2. Set **only** `CONSULTATION_NOTIFICATION_EMAIL=alexander@iteamsystems.com` on
   WEB `srv-dak57did0e5s73b1t0b0` and worker `srv-dak5rurl550s73a17l60`, workspace
   `tea-daipgd67bikc739jftl0`. Both currently use `kochnev@iteam.ru`.
3. Deploy the approved commit to WEB and worker. Auto deploy is off.
   The WEB code accepts the approved v1/v2 revisions during this transition;
   checkout creation still requires the exact active version and digest in the DB.
4. Apply `20261103131640_publish_iteamsystems_contact_documents_v2.sql` to
   Supabase production `fhvxqeaujjeiflanqsbg` only after the new WEB is live.
5. Verify both runtime destinations, four exact v2 digests and active pointers,
   public links and health. Submit one clearly marked test consultation and
   verify its delivery to the new destination. Do not replay old notifications.

An already-open v1 checkout form must be refreshed after switching the active
offer. Existing payments and access grants are not changed. Legal rollback
requires a deliberate pointer change; do not deploy v1-only WEB code while v2
is the active offer.

## Remaining old-domain references

Incoming old-link redirects and exact Auth compatibility callbacks remain to
support previously issued links. They do not route new application actions to
the old domain. Archived migrations, accepted legal v1 revisions, historical
artifacts, existing user addresses and disabled controlled test utilities are
preserved rather than globally rewritten.

## Verification before release

- Scoped UI/PDF/account/billing/consultation/privacy unit tests pass.
- Lint, type check and production build pass (the build uses the same non-secret
  placeholders as CI/Docker; no runtime credentials are required).
- The migration passes in an isolated local PostgreSQL 16 database: exact v2
  bodies/digests, v2 pointers, unchanged historical records, idempotent reapply.
- Public MX records for `iteamsystems.com` resolve to `mx1.privateemail.com` and
  `mx2.privateemail.com`, independently of the old Beget mail service.
- Production was inspected read-only while preparing this change.
