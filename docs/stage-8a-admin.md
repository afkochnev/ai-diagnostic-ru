# Stage 8A — Admin authorization and shell

Status: ACCEPTED after local manual verification. Stage 8B (business-data reads) is not started.

Manual acceptance: an existing local admin fixture had a verified email, the `administrator` role, and an enrolled TOTP factor; after reaching `aal2`, `/ru/admin` loaded successfully. A regular authenticated user was denied access. No credentials, TOTP secrets, tokens, or runtime business data are recorded here.

The post-registration confirmation flow leads new users to `/ru?welcome=1`; ordinary onboarding and company-profile flows remain available through their existing destinations.

## Authorization boundary

Administrator identity comes from the authenticated Supabase session and the server-side `public.user_roles` row with `role = administrator`. `requireIdentity()` additionally requires a verified email and `aal2` MFA assurance for administrator accounts. `requireAdmin()` is the single reusable guard for all future admin pages and redirects non-administrators to `/ru/access-denied`.

The browser cannot supply a role, user ID, company ID, or admin flag. Stage 8A performs no business-data queries and therefore adds no business-data RLS policies. Service-role credentials remain server-only.

## Shell boundary

`/ru/admin` renders only the Russian administrative shell and disabled navigation placeholders for Diagnostics, Companies and users, Consultation requests, Feedback, and Metrics. No diagnostics, profiles, reports, leads, feedback, metrics, or other runtime records are read or changed.

MFA is required by the current security specification (D01). No new MFA policy was introduced in this stage. Manual acceptance still requires an administrator fixture/account; existing production-like users are not promoted automatically.
