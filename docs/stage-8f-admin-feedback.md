# Stage 8F — Admin feedback

Статус: ACCEPTED.

Routes: `/ru/admin/feedback` и `/ru/admin/feedback/[feedbackId]`. Оба read entry points используют server-side `requireAdmin` (authenticated, verified email, administrator, AAL2) и privileged reads. Браузер не обращается напрямую к cross-company данным.

Список показывает дату отзыва, оценку, пользователя, компанию, диагностику и наличие текстовых полей; поддерживает server-side поиск, фильтры, reset и pagination по 20. Сводка считает persisted count и arithmetic average rating. Detail показывает полный useful/improve текст и лёгкие projections пользователя, компании и диагностики со ссылками на Stage 8D/8C.

Feedback полностью read-only. Изменение/удаление, ответы, email, rating distribution и AI-анализ не реализованы. Безопасный `returnTo` переиспользует общий helper и сохраняет фильтры списка.

Rating distribution: NOT IMPLEMENTED. D09: OPEN. D13: OPEN. Stage 8G не начинался.

Manual Stage 8F test: PASS. Проверены список, агрегаты, поиск, фильтры, detail, links/return navigation и ordinary-user denial. Runtime данные не изменялись.

Следующий шаг — закрытие D09. Stage 8G не реализован.
