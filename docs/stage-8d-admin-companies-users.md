# Stage 8D — Admin companies and users

Status: ACCEPTED after manual verification. D09 and D13 remain open.

Manual acceptance confirmed: an administrator with verified email and AAL2 verified both company and user lists, search/filter/reset behavior, read-only detail pages, complete company profile, linked users, diagnostic histories, and Stage 8C links. An ordinary user was denied access. No PII, credentials, MFA secrets, or runtime data are recorded here.

## Routes and read model

- `/ru/admin/companies`
- `/ru/admin/companies/[companyId]`
- `/ru/admin/users`
- `/ru/admin/users/[userId]`

All pages use server-only services in `src/server/admin/companies-users.ts`, which call `requireAdmin()` before privileged reads. The browser receives only projections: company profile fields, human-readable industry/revenue labels, owner user display/contact data, contextual counts, and diagnostic history. Answers, report content, PDF bytes, snapshots, feedback text, and consultation comments are excluded.

The current physical model links a company to its owner through `company_profiles.owner_user_id`; `public.users` has no `company_id`. Counts and histories are fetched in batches per page/detail, and authentication emails are resolved server-side through Supabase Auth admin API.

## Semantics and security

Company and user histories are sorted by `diagnostics.started_at DESC` only as presentation order. No latest/current report or metric semantics are introduced, and no funnel or aggregate metrics are implemented. D09 and D13 remain open.

There are no write actions, role mutation controls, or RLS changes. The service-role client remains server-only. Stage 8A–8C routes and read models remain unchanged.

Stage 8D is accepted. Stage 8E (consultation leads) is the next stage and has not started.
