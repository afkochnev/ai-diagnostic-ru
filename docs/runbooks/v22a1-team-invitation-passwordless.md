# Team invitation and passwordless entry

Team invitations reuse the existing transactional Resend adapter. Set `TEAM_INVITATION_EMAIL_PROVIDER=resend` on the web service, with a verified `EMAIL_FROM` and privately stored `RESEND_API_KEY`. Leave `EMAIL_PROVIDER=mock` to isolate unrelated report and consultation mail on staging. Automated tests must use mock.

Invitation secrets remain 32 random bytes, stored as SHA-256 hashes in the existing private invitation table. The email CTA uses a fragment, which is transferred automatically into the existing encrypted, HttpOnly, 30-minute invitation cookie and removed from the URL. A separate authenticated display envelope supplies company, diagnostic title and inviter without adding a privileged data RPC. Its authenticated hash and recipient must match the live resolver result. Legacy links retain a generic description. No migration is needed.

A confirmed matching session needs consent and acceptance, with no Auth email. A different session receives a masked-recipient explanation and local sign-out action. Otherwise, explicit versioned consent is required before calling Supabase `signInWithOtp`. Existing-user metadata is never sent to that API. Supabase remains the sole issuer/verifier of Auth tokens and sessions.

The exact Team redirect is `/ru/team/confirm`. The staging templates in `supabase/templates/team-*.staging.html` select their Team branch only for the exact staging redirect. Ordinary branches and the recovery template retain their previous behavior. TokenHash travels in the URL fragment and is verified by a server action. Invitation and consent challenge cookies are required in that same browser; opening the Auth email in another browser fails closed. All context is cleared after acceptance or an expired/unavailable action result. Do not enable provider link tracking on Auth emails.

Request acceptance, actual mailbox receipt and successful verification are separate facts. Log only safe status events and provider receipt IDs. Never log invitation secrets, code, Auth hash, session tokens, cookies or answers. A failed request must replace the prior waiting state. No automatic send or resend occurs on page reload. Code entry is a collapsed secondary fallback.

Limits: owner create 20/day, owner invitation 100/day, acceptance 20/hour, Auth send cooldown 60 seconds, invitation and mailbox Auth sends 5/hour each, global Auth sends 100/hour, verification 10/10 minutes. Renewal uses the existing token-rotation RPC and sends one explicit replacement without a new participant or response. Duplicate creation sends nothing.

Before staging changes, retain exact template backups, safe Auth configuration, service versions, empty queues and a protected-row baseline. Rollback restores the exact previous web SHA and two saved template bodies, and removes only newly added web email settings. Preserve fixtures; no production or worker changes belong to this iteration.
