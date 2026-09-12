# Stage 8C — Admin diagnostic detail

Status: ACCEPTED after manual verification. D09 is CLOSED; D13 is CLOSED.

Manual acceptance confirmed: an administrator with verified email and AAL2 opened the control diagnostic detail, verified the complete company profile, persisted result and block scores, ordered answers, all report versions, and explicitly bound PDF artifacts. The page is read-only and an ordinary user remains denied. No PII, credentials, MFA secrets, or runtime data are recorded here.

## Route and authorization

The locale-aware read-only route is `/ru/admin/diagnostics/[diagnosticId]`. Both the page and the PDF artifact endpoint use the shared `requireAdmin()` guard, which enforces authenticated session, verified email, administrator role, and AAL2. Malformed or missing IDs return a controlled not-found response only after authorization. All privileged reads use the server-side service-role client; no admin query or secret is sent to the browser.

## Read model

`getAdminDiagnosticDetail` loads the diagnostic summary, company profile fields, user display data, pinned methodology blocks/questions/translations, answers, persisted deterministic result and block results, all AI report versions, and linked PDF artifact metadata in batched server-side queries. It does not run scoring, AI generation, PDF generation, or any write action. Answer order follows block and question positions from the pinned methodology.

The company profile projection includes all twelve user-facing fields from the profile form: company name, country, industry, products, customer segments, sales channels, employee count, annual revenue, company age, management levels, key problems, and main goals. Industry and revenue codes are resolved through the existing Russian translation tables. For a completed diagnostic with a stored `diagnostic_company_snapshots` row, that immutable snapshot is the display source. A completed diagnostic without a snapshot shows «Исторический профиль компании недоступен» and never silently substitutes current data. An unfinished diagnostic without a snapshot may use the linked current company profile. Empty profile values are shown as «Не указано».

The page shows report versions explicitly and renders saved structured content. It never selects an implicit “latest” report. PDF links read only an existing ready artifact associated with its report/version; missing artifacts display «PDF не сформирован».

Stage 8C does not manage consultation leads or feedback. D09 is CLOSED and D13 is CLOSED. Stage 8D and later admin stages remain separate read-only surfaces.
