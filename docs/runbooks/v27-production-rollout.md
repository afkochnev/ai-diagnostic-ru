# V2.7 — точная инструкция будущего production rollout

Версия: v27-runbook-owner-risk-retention-20261022. Подготовлено к рассмотрению; разрешения на выполнение нет.

**STOP до первой production mutation.** Команды изменения ниже — только будущая
процедура после отдельного разрешения владельца с SHA-256 этой инструкции.
Одобрение PR #7/#8, оферты или этого подготовительного этапа разрешением не является.

## 1. Зафиксированные артефакты и ограничения

| Назначение | Точная идентичность |
| --- | --- |
| Production origin | `https://audit.iteam.ru` |
| Production Supabase | `fhvxqeaujjeiflanqsbg` |
| Render workspace | `tea-daipgd67bikc739jftl0` |
| Production web | `srv-dak57did0e5s73b1t0b0` |
| Production worker | `srv-dak5rurl550s73a17l60` |
| Текущие production web/worker | `0b8c4acb6a1071e5be06268ba8216c4215036e84` |
| Совместимый промежуточный web | `15f36e6ab1ed5229618b34fa3270eca2c47da5ea` |
| Принятый canonical final web | `27e8006152ae1239e03a3f49e31bd519eac5764c` |
| Принятый final worker | `f474a0b125cce0f2b418a569a8b9a95fff3f203f` |
| Общее дерево final web/worker | `dc421c6f30227e55d3d92df000c31db8592e765c` |
| Commercial version | `advanced-terms-ru-v1` |
| SHA-256 оферты | `5e98f8712abd03413598efced5f1e1445701af873e552e32d9797c495191fe94` |

Production baseline на момент проверки: 30 миграций, 38 защищённых таблиц,
8 365 записей; 26 пользователей, 23 компании, 26 диагностик, 26 отчётов и 17 PDF.
Это измерения, а не константы следующего запуска: перед действием снять свежий baseline.
Canonical CI 39823472156: 958 тестов, 8 прежних необязательных пропусков,
сборки приложения/Docker и полный изолированный SQL — PASS.
Staging web работает на canonical SHA; worker сохранён на принятом равном дереве.
Новая TEST-оплата при canonical merge не выполнялась.

Точная последовательность/хеши: `docs/v27-rollout-sequence.json`.
Конфигурационные слоты: `docs/v27-production-configuration.json`; это не файл
для импорта в Environment. Не затирать действующие секреты или Individual-настройки.
Authoritative цена остаётся в `docs/v26b-commercial-config.json`.

## 2. Незакрытые gates — не обходить

1. Финальные privacy/consent тексты остаются неутверждёнными. Следующий пакет:
   `data-processing-policy-ru-v1`, `data-processing-consent-ru-v1`,
   `marketing-consent-ru-v1`; проекты находятся только в `docs/legal/drafts/`.
   `data_processing` и `marketing` остаются `temporary-ru-v1`; исторические
   согласия не переписывать. Публикация требует отдельного утверждения текстов.
   Retention model утверждена владельцем в `docs/v27-retention-model.json`;
   её операционное исполнение не объявлено реализованным.
   `OWNER_ACCEPTED_RU_DATA_LOCALIZATION_RISK` — accepted risk, не blocking gate
   V2.7 и не утверждение полного юридического соответствия. Продолжается текущая
   архитектура Supabase/Render/OpenAI/Resend/YooKassa. Российский data plane,
   self-hosted Supabase и иная миграция локализации для этого запуска не требуются.
   Документы должны прямо раскрывать внешних поставщиков и возможную обработку
   за пределами РФ, без обещания, что все данные физически хранятся в России.
2. Текущий YooKassa adapter — TEST-only. Он блокирует production целиком, в том
   числе TEST-платёж в production. Поддержка реальных платежей `test=false`
   требует отдельной реализации/проверки. `productionEnabled=false` сохраняется.
3. До включения новых Auth-потоков согласовать точный redirect allowlist и
   включение leaked-password protection; сейчас production HIBP выключен.
4. До billing нужны подтверждённые production merchant/receipt/refund settings,
   защищённые live credentials и отдельная приёмка. TEST-реквизиты не копировать.
5. Перед первым изменением нужен свежий проверенный recovery point/backup,
   ответственное лицо и отдельное разрешение на точный rollout. Новый backup
   и восстановление в V2.7 preparation не выполнялись.

Разрешённая будущая техническая выкладка с новыми возможностями OFF также
требует отдельного решения владельца с явным перечислением оставшихся gates;
эта инструкция не объявляет такое исключение разрешённым.

## 3. Read-only проверки перед окном работ

В репозитории убедиться в точном дереве и required CI:

```sh
git rev-parse 27e8006152ae1239e03a3f49e31bd519eac5764c^{tree}
git rev-parse f474a0b125cce0f2b418a569a8b9a95fff3f203f^{tree}
gh run view 39823472156 --json headSha,status,conclusion,jobs
render workspace current --output json
render services --output json
```

Оба дерева должны быть `dc421c6f30227e55d3d92df000c31db8592e765c`; CI — success
для application и isolated-sql. Workspace — только указанный выше; production
web/worker не suspended, auto-deploy OFF и previews OFF. Не переключать workspace
молча. Если состояние изменилось, остановиться и пересобрать доказательства.

Снять новый metadata-only snapshot/ledger/counts/отпечатки с read-only транзакцией;
не сохранять сырые ответы, токены, email или session cookies. До A production
Account-таблиц ещё нет: компании считать в `public.company_profiles`.

Точная проверка полного пакета без изменений:

```sh
"/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/ai-diagnostic-v22a-team-foundation/node_modules/.bin/supabase" --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --dry-run --skip-vault --workdir "/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/artifacts/v27-production-launch/approved-offer-staging/production-phase-packages/final/"
```

Ожидание на исходном ledger30: только 17 файлов таблицы ниже.
Если появляется `20260918000100`, любой дополнительный файл, неопределённая
provenance либо ошибка CLI — STOP. Запрещены include-all, reset, migration/ledger
repair, seed/roles replay и произвольный schema push. `--skip-vault` обязателен.

## 4. Первая mutation — только после отдельного разрешения

В разрешении должны быть названы инструкция/её хеш, все 17 migration hashes,
промежуточный и final service SHAs, backup/write-pause/drain и флаги OFF.

Сначала backup gate, непосредственно перед первой production mutation.

Backup gate: в
`https://supabase.com/dashboard/project/fhvxqeaujjeiflanqsbg/database/backups`
зафиксировать свежий completed recovery point, время и пригодность восстановления.
Daily physical backups доступны; PITR сейчас OFF, старый daily backup нельзя
объявлять созданным непосредственно перед rollout. Если нужного recovery point
нет, STOP: отдельно согласовать fresh logical backup с защищённым хранением
вне release artifacts или другой подтверждённый механизм. Никакой backup export,
restore, платный PITR или изменение конфигурации в текущей preparation не разрешены.
DB backups не покрывают Storage object bytes: сверить inventory отдельно.

Точный write pause для платного production web:

```sh
render services update srv-dak57did0e5s73b1t0b0 --maintenance-mode=true --confirm --output json
```

Проверить readback `maintenanceMode.enabled=true` и HTTP503 для
`https://audit.iteam.ru`. Это закрывает публичный web-трафик, но не доступ к
Supabase Data API/private network. До A/B проверить отсутствие самостоятельных
внешних writers/прямых API-клиентов; одного HTTP503 для доказательства тишины мало.
Никакие неизвестные транзакции/очереди не удалять.

Проверка V1 очередей — read-only SQL через защищённый операторский доступ:

```sql
begin transaction isolation level repeatable read read only;
select kind,status,count(*) from public.jobs group by kind,status;
select count(*) unsafe_jobs from public.jobs
where status::text in ('queued','running','processing')
   or (status::text='failed' and attempts<3 and available_at<=now());
select count(*) active_or_uncertain_leases from public.jobs
where lease_expires_at>now()
   or (status::text in ('running','processing') and lease_token is not null);
select status,count(*) from public.email_deliveries group by status;
rollback;
```

Требуется unsafe_jobs=0 и active_or_uncertain_leases=0, email queue понятна;
неизвестный результат провайдера — STOP до сверки по прежнему request ID.

## 5. Account Phase A → совместимый web

Сначала dry-run пакета A, затем apply **только под отдельным разрешением**:

```sh
"/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/ai-diagnostic-v22a-team-foundation/node_modules/.bin/supabase" --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --dry-run --skip-vault --workdir "/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/artifacts/v27-production-launch/approved-offer-staging/production-phase-packages/phase-a/"
"/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/ai-diagnostic-v22a-team-foundation/node_modules/.bin/supabase" --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --skip-vault --workdir "/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/artifacts/v27-production-launch/approved-offer-staging/production-phase-packages/phase-a/"
```

На ledger30 ожидается только `20261013000100_account_foundation.sql`.
После успешного применения ledger31, старые данные неизменны, owner backfill
соответствует каждому исходному пользователю/компании. Не создавать Advanced.
Оригинальный V1 worker ещё допустим при прежних claim contracts и пустых очередях.

```sh
render deploys create srv-dak57did0e5s73b1t0b0 --commit 15f36e6ab1ed5229618b34fa3270eca2c47da5ea --wait --confirm --output json
```

Принять только deploy `live` на точном SHA; auto-deploy остаётся OFF.
Под разрешённой операторской сессией проверить Company/Individual/result/PDF,
чужую компанию — отказ. Пока публичный write pause включён, использовать
контролируемый доступ; если для browser smoke требуется снять pause, это отдельный
зафиксированный подпункт разрешённого окна, после него повторить drain/pause.
Изолированные app-service/RLS-тесты — доказательство контрактов, а не утверждение,
что каждая final-страница совместима с неполной схемой.

## 6. До Phase B остановить только production worker

После повторного drain выполнить точное действие Render API через защищённый
Bearer из credential store (не помещать его в команду, файл, чат или лог):

```http
POST https://api.render.com/v1/services/srv-dak5rurl550s73a17l60/suspend
```

Ожидание HTTP202; readback именно этого service ID: `suspended=suspended`.
Дождаться завершения процесса и отсутствия leases/uncertain requests. Suspend
не считать доказательством успешного завершения начатого внешнего запроса.
Другие сервисы/worker не останавливать.

## 7. Phase B → tail, worker остаётся остановленным

```sh
"/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/ai-diagnostic-v22a-team-foundation/node_modules/.bin/supabase" --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --dry-run --skip-vault --workdir "/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/artifacts/v27-production-launch/approved-offer-staging/production-phase-packages/phase-b/"
"/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/ai-diagnostic-v22a-team-foundation/node_modules/.bin/supabase" --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --skip-vault --workdir "/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/artifacts/v27-production-launch/approved-offer-staging/production-phase-packages/phase-b/"
```

После A ожидается только `20261013000200_account_authorization_cutover.sql`,
затем ledger32. На исходном ledger30 dry-run B закономерно показывает A+B;
не использовать такой результат как разрешение пропустить проверку между ними.
С Phase B оригинальный V1 web больше не является общим rollback-артефактом,
особенно после нескольких компаний на Account. Промежуточный web остаётся MID.

```sh
"/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/ai-diagnostic-v22a-team-foundation/node_modules/.bin/supabase" --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --dry-run --skip-vault --workdir "/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/artifacts/v27-production-launch/approved-offer-staging/production-phase-packages/final/"
"/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/ai-diagnostic-v22a-team-foundation/node_modules/.bin/supabase" --agent no --output pretty db push --project-ref fhvxqeaujjeiflanqsbg --skip-vault --workdir "/Users/alexanderkochnev/Documents/ChatGPT/AI Company Audit/artifacts/v27-production-launch/approved-offer-staging/production-phase-packages/final/"
```

После A/B ожидаются только оставшиеся 15 файлов таблицы ниже, затем ledger47.
При любом другом наборе/ошибке — STOP, без history repair и без down migrations.
Сверить source hashes и исходные строки; публикация оферты additive и не должна
заменять существующий v1 с иным содержимым.

## 8. Final app/worker с возможностями OFF

До старта final runtime через Environment только точных production сервисов
установить согласованные новые флаги из `docs/v27-production-configuration.json`:
ACQUISITION_ENABLED=false, ACQUISITION_START_ENABLED=false, TEAM_ENABLED=false,
TEAM_CREATION_ENABLED=false, TEAM_INVITATIONS_ENABLED=false, BILLING_ENABLED=false,
YOOKASSA_REFUNDS_ENABLED=false. Проверить и три false в `private.launch_controls`.
Сохранить прежние Individual AI/email secrets/settings; пустые config slots не импортировать.

```sh
render deploys create srv-dak57did0e5s73b1t0b0 --commit 27e8006152ae1239e03a3f49e31bd519eac5764c --wait --confirm --output json
```

Для worker: resume может создать deploy по связанному main. До resume сверить,
что remote main всё ещё точный canonical SHA с равным деревом. Если main изменился,
STOP и пересмотреть управление источником. Только после этой проверки:

```http
POST https://api.render.com/v1/services/srv-dak5rurl550s73a17l60/resume
```

Дождаться live, проверить фактический commit/tree и безопасные env.
Затем при необходимости закрепить принятый worker artifact:

```sh
render deploys create srv-dak5rurl550s73a17l60 --commit f474a0b125cce0f2b418a569a8b9a95fff3f203f --wait --confirm --output json
```

Если resume уже дал точное принятое дерево/runtime, повторный deploy ради
совпадения SHA не нужен. При расхождении не допускать неизвестный worker к очередям;
остановиться, сохранить OFF, forward containment по фактической схеме.

## 9. Postflight и отдельные enablement gates

Через контролируемый доступ проверить health200, login, исходные Company,
Individual diagnostics/results/reports/PDF; owner/foreign/Admin boundaries;
все существующие Accounts — Free, прежние Individual отчёты доступны без оплаты.
Admin smoke требует заранее подтверждённой production administrator-сессии;
временную staging-роль и staging user ID в production не переносить.
Проверить System Health: public jobs, Team jobs, AI/email failures, billing
webhook failure, stale checkout, receipt failure/pending; никаких секретов/сырых ответов.

Сравнить postflight с fresh baseline: исходные строки неизменны; допустимы только
документированные migration backfill/seed additions. Не сравнивать только общий count.
Лишь после принятия postflight под отдельным разрешением снять maintenance:

```sh
render services update srv-dak57did0e5s73b1t0b0 --maintenance-mode=false --confirm --output json
```

Следующие включения независимы: anonymous/Team после privacy/consent/Auth gates,
затем billing последним. Реальные письма/AI требуют отдельного bounded smoke.
Для billing до любой live оплаты требуется новый production-capable адаптер,
`test=false`, точный merchant и production pair, без TEST credentials.
Authoritative productionEnabled остаётся false до отдельно принятого изменения.

Правильный будущий production webhook:
`https://audit.iteam.ru/api/billing/webhook/yookassa`;
события payment.succeeded, payment.canceled. Путь из исходного задания
`/api/billing/yookassa/webhook` не совпадает с реализованным endpoint.
Не создавать production subscription на этом этапе. Refund webhook — отдельная
проверенная конфигурация; реальных возвратов preparation не выполняет.
Цена480 RUB, service, full_payment, vat_code1, без НДС/его суммы/автопродления.
USN subtype не определён; tax_system_code — только если нужен выбранной кассе
и подтверждён бухгалтерией. Проверка production receipt succeeded — отдельный live smoke.

## 10. Containment и восстановление

- До B: сохранять A/backfill; только проверенный для фактического ownership
  V1/A-compatible артефакт. После B — MID на неполной схеме или принятый final
  на полном ledger47. Общего возврата к V1 после cutover нет.
- `BILLING_ENABLED=false` останавливает новые оплаты, сохраняет оплаченный доступ.
  `YOOKASSA_RECONCILIATION_ENABLED=false` — отдельный provider stop. Не создавать
  новую оплату/возврат для выяснения состояния прежней: использовать authenticated GET.
- Для acquisition остановить новые starts app+DB-флагом; для Team — creation/invites
  app+DB-флагами. Существующие claimed users, Team participation/results и данные сохранить.
- Refund initiation OFF. Только проверенный successful полный refund480 завершает
  Advanced и переводит Account в Free; pending/canceled не понижают тариф,
  duplicate old refund не отзывает позднейшую покупку. Историю не удалять.
- При проблеме worker: drain → POST suspend точного production ID → readback;
  не удалять jobs и не освобождать leases вручную. Resume только после проверки
  выбранного artifact/env/schema, с явным учётом создаваемой deployment операции.
- Restore — отдельное согласованное recovery-действие с известным backup, scope
  потери новых записей и Storage objects. Backup capability проверена; restore не репетировался.

## 11. Точный migration inventory

| Порядок | Файл | SHA-256 |
| --- | --- | --- |
| 1 | `20261013000100_account_foundation.sql` | `eea60518cb1e3860aa9f69b65bb3305f7d60ab1d6a5ee6df98ae18886eba10f9` |
| 2 | `20261013000200_account_authorization_cutover.sql` | `785a1b9de7d1ae155a80325fc3fde6838ddfb668aff7d2457b476e229a3ca510` |
| 3 | `20261015135524_team_diagnostic_foundation.sql` | `fe8df4214ca85d824314e058447ee652e9c075c306f793dd9c35ddb35c41ae19` |
| 4 | `20261015170255_team_aggregation_report.sql` | `aeb275eb161d3b9d3ae0d7882aecef2644ff0979fa8a6edb85ee67c923659b89` |
| 5 | `20261016075550_team_participant_passwordless.sql` | `bfb2ace6f36ff202f08c7054211e355a68a1ae980c9eff6fe64a663eaa4a7e85` |
| 6 | `20261016175038_team_single_email_consent.sql` | `fcc8b41a0f9b74ae17646eaa0ee8c6347b5d10afb164d9c96da806a116eb79e1` |
| 7 | `20261018071921_plans_entitlements_billing_foundation.sql` | `1a3e534b89e7cd33531491315ee6dbd0be056d3b4b18f858aa0288e457a17dfe` |
| 8 | `20261018105321_rich_team_ai_report_v2.sql` | `189bd57717c9fe25afb00ad6c2a2b95faf644333f9a169f9d5c289362c471d7d` |
| 9 | `20261018171308_team_synthesis_bounded_repair.sql` | `40e4271c92723f010840f7ffdf204bd1b1612fb304e9a3f2485a9a4d59262497` |
| 10 | `20261019073437_team_report_v3_and_pdf.sql` | `00f346fe3e768a2ffb2d6575fb3068d4cf5e9bb652c3e720f298cb254efbbcdd` |
| 11 | `20261020170720_v24_admin_console_and_plan_audit.sql` | `54d36156707b95e094f528ff3d7da3d34cba1793e33741169afe29cbab7fcf53` |
| 12 | `20261020191130_anonymous_free_diagnostic_funnel.sql` | `9a0611e003bcaeefdfa5e1f33ec68495ed0151de1aea9a69b2ef8810dc9eb53e` |
| 13 | `20261021132005_billing_commercial_activation.sql` | `2e6eb79c667bd11520c33b91b75ea7d6edeb9c90d59857273da7734c1cee1f1d` |
| 14 | `20261021164251_yookassa_annual_billing.sql` | `17fe0fcea30668f91d40095da4324994fe2a1246f0466ddd52b82775d0cadf70` |
| 15 | `20261022130314_commercial_terms_and_full_refunds.sql` | `f717909be77ea4438f2dc88a7cbe2c826b625c47eba17dba039b44b24634836e` |
| 16 | `20261022131400_controlled_launch_gates.sql` | `68dd27b6e091b716785e6f3f2a10acb061a96997ebfc85745acb112f3b0aaf22` |
| 17 | `20261022133523_publish_advanced_terms_ru_v1.sql` | `ae5f937e573d95be28a2810c409f8aa184cd0173f4797b0b345524f6c5b59ed9` |

## 12. Формат будущего разрешения

До утверждения финальных privacy/consent текстов и закрытия технических/configuration gates rollout
не запрашивается как готовый к исполнению. Когда gates закрыты, разрешение
должно прямо назвать `v27-runbook-owner-risk-retention-20261022` и фактический SHA-256
этого файла, migration inventory из раздела11, intermediate/final web/worker
из раздела1, backup/drain/write-pause, initial flags OFF и границы smoke.
Это описание необходимых полей разрешения, а не предоставленное разрешение.
Если runtime или миграции изменятся, нужен новый кандидат/хеш и затронутая staging-приёмка.

Источники процедур: [Render deploys](https://render.com/docs/deploys),
[maintenance](https://render.com/docs/maintenance-mode),
[suspend](https://api-docs.render.com/reference/suspend-service-1),
[resume](https://api-docs.render.com/reference/resume-service-1),
[Supabase backups](https://supabase.com/docs/guides/platform/backups).
CLI-синтаксис проверен по installed Render2.28.0 / Supabase2.117.0 help.
