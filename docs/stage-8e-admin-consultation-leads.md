# Stage 8E — Admin consultation leads

Статус: ACCEPTED.

Список `/ru/admin/leads` и detail `/ru/admin/leads/[leadId]` доступны только через server-side `requireAdmin` (authenticated, verified email, administrator, AAL2). Данные читаются privileged client на сервере и передаются в минимальных DTO; браузер не выполняет cross-company queries.

Список использует `lead_requests.created_at DESC` (дата заявки), поиск по имени, email и названию компании, фильтры статуса/дат/состояния delivery, reset и server-side pagination по 20 записей. Detail показывает контакт, компанию, пользователя, диагностическую projection и persisted delivery/job state со ссылками на принятые admin-разделы.

Раздел полностью read-only: status mutation, retry/reclaim, отправка email и запуск worker отсутствуют. Полные комментарии доступны только на detail. AI/PDF/feedback данные не загружаются.

Lead status mutation: NOT IMPLEMENTED / PRODUCT DECISION OPEN.
D09: OPEN. D13: OPEN. Stage 8F не начинался.

Manual Stage 8E test: PASS. Manual UX retest: PASS (compact delivery state, technical disclosure, validated return navigation with preserved list query parameters). Runtime data не изменялись.

Stage 8F — следующий этап: Admin Feedback.
