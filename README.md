# Мясной Батя — Review Activator DEV

## Current checkpoint — encrypted session decrypt classification 07A.5F

The protected offline preflight now distinguishes malformed envelope/key/AAD
inputs, AES-GCM authentication failure, and post-AES plaintext JSON/schema
failure using safe allowlisted codes. The legacy decrypt API remains generic;
no plaintext, cookie, key, IV, tag or ciphertext is returned. This checkpoint
is local and does not repair or transition the current DEV session. See
[Yandex session decrypt forensics 07A.5F](docs/YANDEX_SESSION_DECRYPT_FORENSICS_07A5F.md).

## Current checkpoint — Yandex contract diagnostic 07A.5

The existing protected worker boundary now has a read-only
`contract_diagnostic` operation for one Asbest page-1 GET. It reports only
safe response schema and the allowlisted parser failure point; it does not
claim runs, persist reviews, change session/connection state or enable the
paused scheduler. Live drift evidence remains pending the single operator
diagnostic request.

See [Yandex contract diagnostic 07A.5](docs/YANDEX_CONTRACT_DIAGNOSTIC_07A5.md).

## Current checkpoint — Yandex connection reconciliation 07A.4B

The Asbest DEV provider connection has a server-only, fixed-scope reconciliation
boundary for clearing the stale `SESSION_DECRYPT_FAILED` connection state after
the private session is verified `READY`. It does not enqueue, fetch from Yandex,
write reviews or enable the paused scheduler. See
[Yandex connection reconciliation 07A.4B](docs/YANDEX_CONNECTION_RECONCILIATION_07A4B.md).

## Current checkpoint — Asbest admin reviews read-only UI 06

The existing admin page now reads the 67 persisted Asbest Yandex reviews through
the scoped `review_admin_reviews_scoped` RPC. It is paginated, newest-first,
shows owner replies and the 13 unanswered reviews, and has no reply/matching/
promo mutation path. The DEV-only migration and security contract are documented
in [Yandex Admin Reviews UI 06](docs/YANDEX_ADMIN_REVIEWS_UI_06.md).

The legacy unscoped browser RPC is revoked. Scheduler remains PAUSED; Business OS
and production are outside this repository and were not changed.

## Current checkpoint — Yandex scoped persistence + atomic writer 04

DEV-only scoped persistence hardening is complete and applied to the dedicated
Review Activator DEV Supabase project. The writer exists behind a server-only,
service-role RPC, but it is **not wired into the live Yandex dry-run path** and
no real reviews were persisted. `review_external_reviews` remains empty,
`review-provider-due-check-hourly` remains PAUSED, and no Yandex write was made.
See [the 04 audit and handoff](docs/YANDEX_SCOPED_PERSISTENCE_04.md).
The idempotency correction and controlled no-op replay are recorded in
[05A](docs/YANDEX_PERSISTENCE_IDEMPOTENCY_05A.md).

Изолированный Review Activator DEV: интерфейс `v0.4 BRAND` и последующая server foundation.

Локальное расширение 0.2.4: по явному разрешению partitioned cookies исключаются
до лимита 100 и проверки дубликатов. Server validator не изменён; реальные import/GET
не выполнялись в этом изменении. [Security review и порядок проверки](docs/YANDEX_NATIVE_IMPORT_V4.md).

## Scope

[Full dry-run 03 PASS](docs/YANDEX_FULL_DRY_RUN_03.md): 4 страницы, 67 уникальных
отзывов, 0 дубликатов/коллизий; Unix milliseconds, public_rating boolean.
Session READY/revision 4 по отчёту оператора. Persistence OFF; scheduler не включён.

Предыдущий live checkpoint: [probe 02 PASS](docs/YANDEX_PAGINATION_PROBE_02.md),
Асбест base=1, page=0 alias первой страницы; session READY/revision 3 по отчёту
оператора. Full fetch не запускался, persistence OFF, scheduler не включён.

- Клиентский интерфейс: `index.html`, административный: `admin.html`.
- Server endpoints используют отдельный Review Activator Supabase DEV, не Business OS.
- Yandex server-only session transport реализован и тестируется на fixtures; реальные session/read не включены.
- Business OS API, рекламные кабинеты и production-интеграции не входят в scope.
- QR в этой версии — визуальный preview; локальные ссылки с `#r=TOKEN` работают в браузере.

## Local run

Откройте `START_LOCAL_DEMO.bat` или запустите любой static HTTP server из корня проекта.

Static server не запускает server endpoints. Открытие UI может использовать уже
подключённый DEV backend; для полностью offline-проверки используйте тесты ниже.

## Offline checks (Node 22+)

```sh
npm ci --ignore-scripts
npm test
npm run check
git diff --check
```

Внешний Fetch в тестах запрещён; provider/RPC вызовы замоканы. PostgreSQL-тесты используют
dev-only PGlite в памяти, без подключения к DEV БД. Check компилирует JS/inline scripts
и проверяет JSON без выполнения кода.

## Yandex Session Transport v1 — current

[Локальная настройка server-only ключей](docs/YANDEX_LOCAL_DEV_KEYS.md): скрытый ввод
DEV service key, генерация AES-256 keyring только в памяти процесса, безопасный read-only
preflight. Владелец подтвердил setup/all checks PASS; ожидается ручной session input.
Исправлена диагностика отказа до prompt: PowerShell 5.1 получает понятную ошибку;
prompt в PowerShell 7 проверен без ввода секрета. `& .ps1` сохраняет env в том же процессе.
[Native import v4: исходники и security review](docs/YANDEX_NATIVE_IMPORT_V4.md).
Текущий шаг — «Диагностика без импорта» в 0.2.3: сводные количества и дубликаты
только среди прошедших проверку метаданных записей,
после подтверждённого COOKIE_SET_TOO_LARGE, без имён/values/CLI/БД.
Лимит импорта и validator не менялись; среди 22 прошедших проверку метаданных
записей ещё предстоит проверить дубликаты, значения не проверялись.
После разовой регистрации локального адаптера: запустить importer в прежнем PS7 и
нажать «Подключить Яндекс Бизнес». Cookies/header/JSON/metadata вручную не переносятся.
Native Messaging + Windows same-user pipe; никакого HTTP/clipboard/browser network.
Первая попытка остановилась до CLI; регистрация и локальный адаптер проверены.
Ожидаются два счётчика eligible_duplicate_name_* из 0.2.3 в настоящем Chrome.
Helper переиспользует
`scripts/import-yandex-session.ps1` и существующий CLI, не запускает GET/alerts.

[Live Read Smoke 01](docs/YANDEX_LIVE_READ_SMOKE_01.md): отдельный synthetic DEV scope
Асбеста подготовлен; session отсутствует. Ожидается ручной server-side import.
Реального smoke ещё не было; persistence OFF, scheduler PAUSED.

[Архитектура, private storage, privileges, безопасный import и live smoke](docs/YANDEX_SESSION_TRANSPORT_V1.md).
AES-GCM, scoped CAS и fail-closed read используют существующий YandexProvider.
Session не импортирована; реальных запросов нет. Persistence OFF, scheduler PAUSED.
Первый live import/read требует отдельного подтверждения и проверенного company/location mapping.

## Sync Boundary Remediation 02

[Аудит, права, callers, scheduler и persistence plan](docs/SYNC_BOUNDARY_REMEDIATION_02.md).
В DEV применена RPC security migration: public enqueue закрыт, существующий engine
требует company UUID и service_role/postgres. Legacy hourly job приостановлен, не удалён.
Новый server caller пока только в локальном коде, без push/deploy/реальных service keys.
Yandex requests и persistence не включены в runtime path; scoped-index/atomic
writer hardening выполнен отдельной DEV-only миграцией 04, но writer требует
отдельного явного запуска после следующего аудита.

## Yandex Foundation Remediation 01

- [Контракт, точная модель, пагинация, cron security](docs/YANDEX_REVIEW_PROVIDER.md).
- [Проверенная схема DEV, миграции, RPC/индексы и риски](docs/REVIEW_EXTERNAL_REVIEWS_SCHEMA.md).
- [Происхождение fixtures](test/fixtures/yandex/README.md).

Этот checkpoint описывает состояние до Remediation 02. Найденный в нём обход public
enqueue RPC теперь закрыт; persistence/index и live transport остаются отдельными этапами.

## Vercel

Статические страницы и server functions, без отдельного frontend build command.
Deployment target — DEV/Preview only. Vercel Hobby не используется для hourly cron;
существующий hourly job в отдельном Supabase DEV приостановлен в Remediation 02.
Push/deploy, запуск scheduler и Yandex transport в Remediation 02 не выполнялись.
