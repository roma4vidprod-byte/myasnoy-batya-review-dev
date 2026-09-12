# Мясной Батя — Review Activator DEV

Изолированный Review Activator DEV: интерфейс `v0.4 BRAND` и последующая server foundation.

## Scope

- Клиентский интерфейс: `index.html`, административный: `admin.html`.
- Server endpoints используют отдельный Review Activator Supabase DEV, не Business OS.
- Yandex read foundation тестируется на синтетических fixtures; session/auth transport не реализован.
- Business OS API, рекламные кабинеты и production-интеграции не входят в scope.
- QR в этой версии — визуальный preview; локальные ссылки с `#r=TOKEN` работают в браузере.

## Local run

Откройте `START_LOCAL_DEMO.bat` или запустите любой static HTTP server из корня проекта.

Static server не запускает server endpoints. Открытие UI может использовать уже
подключённый DEV backend; для полностью offline-проверки используйте тесты ниже.

## Offline checks (Node 22+)

```sh
npm test
npm run check
git diff --check
```

Внешний Fetch в тестах запрещён; provider/RPC вызовы замоканы. Нет сторонних test
dependencies. Check компилирует JS/inline scripts и проверяет JSON без выполнения кода.

## Yandex Foundation Remediation 01

- [Контракт, точная модель, пагинация, cron security](docs/YANDEX_REVIEW_PROVIDER.md).
- [Проверенная схема DEV, миграции, RPC/индексы и риски](docs/REVIEW_EXTERNAL_REVIEWS_SCHEMA.md).
- [Происхождение fixtures](test/fixtures/yandex/README.md).

HTTP cron закрыт при missing/wrong secret, но существующая public enqueue RPC
требует отдельного hardening. Весь sync периметр пока нельзя считать закрытым.

## Vercel

Статические страницы и server functions, без отдельного frontend build command.
Deployment target — DEV/Preview only. Vercel Hobby не используется для hourly cron;
существующий hourly job находится в отдельном Supabase DEV. В Remediation 01 не
выполнялись push/deploy, новые scheduler jobs, DB mutations и Yandex transport.
