# Stage 8B — Admin diagnostics list

Status: ACCEPTED after manual verification. D09 and D13 remain open.

Manual acceptance confirmed: an administrator with verified email and AAL2 opened the list, checked real projections, search, filters, and reset behavior. An ordinary authenticated user was denied access. No PII, credentials, or MFA secrets are recorded here.

## Read model

`getAdminDiagnostics` is a server-only service. It calls `requireAdmin()` before using the server-side service-role client. The browser receives only bounded list projections: company name, user display name, `diagnostics.started_at` (shown as «Дата начала»), completion date, status, deterministic display index, maturity label, report presence/status/version projection, feedback rating, and consultation status.

Answers, full company profiles, report text, PDF bytes, feedback text, and consultation comments are not selected.

## Search and filters

Search is limited to company name and user full name, trimmed and capped at 100 characters. Status, start date range, report presence, feedback presence, and consultation presence are validated server-side. Default ordering is `diagnostics.started_at DESC`; page size is fixed at 20. Query parameters are reflected in the URL and «Сбросить фильтры» returns the default list.

The list deliberately does not define a “latest” report/result meaning. Report versions are shown only as an available version projection. D13 remains open.

## Security

There are no admin business-data RLS changes in this stage. All cross-company reads are performed server-side after the shared administrator, verified-email, and AAL2 checks. No service-role credential or direct Supabase admin query is exposed to the client.

The route is `/ru/admin/diagnostics`; other Admin shell sections remain placeholders. Stage 8B has no write actions. Stage 8C is the next planned read-only diagnostic detail stage and has not been implemented.
