# Мясной Батя — Review Activator DEV

Изолированный Review Activator DEV: интерфейс `v0.4 BRAND` и последующая server foundation.

## Scope

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
[Browser cookie helper](docs/YANDEX_BROWSER_SESSION_HELPER.md) собирает cookies по полям,
значения — скрыто; пользователю не нужно составлять JSON. Он переиспользует
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
Yandex requests и persistence не включены; scoped-index migration остаётся планом.

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
