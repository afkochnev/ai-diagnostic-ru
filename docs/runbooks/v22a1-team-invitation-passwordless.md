# Team invitation and single-email entry

## Current candidate (not deployed)

The normal real-provider path sends **one email**: owner invitation → participant opens the invitation in any browser → company/team/inviter/privacy context → personal consent → questionnaire. There is no numeric-code field, second Auth email, password setup, or requirement to open mail inside a browser. Mail clients may open the link in the recipient’s preferred browser.

After the owner-scoped invitation RPC succeeds, the server reserves a five-minute, nonce-bound pending identity slot for a new email and calls supported Supabase `auth.admin.generateLink` (`invite` for a new identity, `magiclink` for an existing identity). This generates a Supabase credential without sending an Auth email. The existing transactional Resend adapter sends the only email. No consent is fabricated. Creating the preliminary Auth row before consent was explicitly approved by the owner on 2026-10-16.

The complete link is never returned to the owner, including on provider failure or in mock mode. Mock delivery does not call Auth or create pending identities. A fallback copied application invitation contains no Auth proof. Such legacy links can still use the previous consent-first Auth-email path; they are not the normal one-email acceptance proof.

The combined email CTA contains the application invitation and an encrypted Supabase proof in its fragment. Existing invitation/display sealing remains unchanged. A purpose-separated authenticated envelope holds the Supabase-issued hash, recipient, invitation hash, verification type and original issue expiry. It protects a Supabase credential; it does not mint an Auth token or implement a new Auth authority. The browser seals context into HttpOnly cookies and removes the fragment. Opening a link or scanning its GET does not verify Auth, provision an application identity, or accept the invitation.

The combined sign-in proof expires after **30 minutes from issuance**, including across browser refreshes. The email states this explicitly. Reopening it never extends expiry. After expiry the organizer must send a replacement invitation. Owner renewal rotates the application token and issues one replacement Supabase proof; a pending user remains the same Auth identity. Old links fail the active invitation resolver.

On a consent POST, the application checks current policy versions, wrong active session, current invitation/team availability and limits. A matching verified recipient does not need another Auth verification; otherwise Supabase verifies the mailed credential. The database then atomically finalizes the pending identity and accepts the invitation. A role and personal Account are provisioned only then; marketing is false, no Company is created, and no inviter Account membership is granted. Existing users’ metadata, password and role are not updated.

The additive candidate migration `20261016175038_team_single_email_consent.sql` creates a private RLS-protected reservation table, one service-only reservation RPC, and one authenticated consent-finalization RPC. The original signup provisioning body remains intact for all ordinary registrations. Its new pending branch requires both a private server-created reservation and a matching high-entropy nonce; editable metadata alone cannot activate it. The shared verified-session predicate denies unfinished pending identities, including direct RPC attempts. The finalizer preserves established Team locking and administrator assurance checks. Existing migration files remain immutable.

## Configuration and logs

Set `TEAM_INVITATION_EMAIL_PROVIDER=resend` on web with verified `EMAIL_FROM` and privately stored `RESEND_API_KEY`; keep unrelated `EMAIL_PROVIDER=mock`. The one-email path needs no new Render variable and no SMTP or Auth-template modification. The local Team-specific templates remove visible numeric fallback for legacy entry; ordinary branches and recovery remain unchanged. Do not enable Auth link tracking.

Never log complete links, proof envelopes, nonce, Supabase hashes, sessions, cookies, codes or private answers. Owner responses contain only send status and safe provider receipt IDs; failed delivery exposes only the separate application invitation fallback. API/provider acceptance, inbox receipt, consent and questionnaire entry are distinct evidence.

## Rollout and rollback

Apply no remote migration until the owner approves its exact source and hash. Before approved rollout, capture current staging web/worker, migration ledger, queues and a fresh protected-row baseline. Apply the additive migration before deploying the web candidate. Test one controlled fresh recipient and one existing recipient, maximum one combined real email each. Consent is entered personally; no questionnaire answers are required. Production, worker and existing fixtures stay unchanged.

For rollback, restore the previous web first and disable only reservation creation and finalization entry. Keep the new table and pending-identity guard so preliminary identities cannot bypass consent; do not delete pending Auth users, reservations or fixtures. Existing normal signup/login/legacy invitation paths remain usable, and no old migration is edited. SMTP, keys, sender and other Render settings require no rollback because this candidate does not change them.
