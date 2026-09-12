# Stage 8G — Admin metrics

Статус: ACCEPTED.

D09 закрыт: основной diagnostic funnel использует уникальные `diagnostic_id`, cohort определяется по `diagnostics.started_at`, границы периода рассчитываются в UTC. Этапы: started → completed → completed AI report → consultation lead; feedback показывается отдельным этапом после completed с denominator completed diagnostics.

KPI используют собственные persisted timestamps: Auth registration/confirmation, company `created_at`, diagnostic start/completion, report `created_at`, PDF `generated_at`, email request/sent, lead and feedback `created_at`. Report funnel stage дедуплицируется по diagnostic id; report versions, artifacts, deliveries и attempts считаются отдельными operational records согласно D09.

Visitors, anonymous sessions, PDF downloads, report views, inbox delivery, consultation completion, rating distribution и conversion-to-registration не реализованы. Все reads и агрегаты server-side через `requireAdmin`; client raw dataset не получает. D13: OPEN.

Manual Stage 8G test: PASS. Проверены all-time KPI, date range, reset, cohort funnel, conversions, empty period, zero denominators и ordinary-user denial. Future analytics instrumentation не входит в Stage 8G. Runtime данные не изменялись.
