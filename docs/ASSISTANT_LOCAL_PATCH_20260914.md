# Review Activator — исправления на фактических исходниках

Дата: 14 сентября 2026 года.
Статус: LOCAL_INTEGRATED_PATCH / 112_ADDITIONAL_CHECKS_PASS / WINDOWS_GATE_PENDING / NOT_DEPLOYED.

## Исходник и границы

Принят myasnoy-batya-review-dev.zip. SHA-256 исходного архива:
`1c7ea75724efc00e6487909c1796c3831c9c242bb07aa02cbc4e9b9a7027fec4`.
Git HEAD: `f848d8ba9cf3e6890eca6ba79e16f210eaa066fa`.
Ветка из архива: `codex/yandex-live-read-smoke-01`.
Все 159 tracked файлов совпали с Git-объектами; различия CRLF/LF при наличии приведены к оригинальным Git bytes. Не использован старый remote main. Это сравнение исходников архива, а не новая проверка состава Vercel deployment.

В архиве был `.env.local`. Его значения не печатались, не использовались в тестах и не включены в результаты. `.git`, `.vercel`, исходные node_modules, env и supabase/.temp не включаются в итоговый исходный архив. Тестовый PGlite взят из вложенного node_modules и имеет версию 0.5.8, соответствующую package-lock; lockfile и версия зависимости не менялись. Секреты для тестов — исключительно synthetic. Файл с потенциально действующими ключами не следует пересылать повторно; необходимую ротацию планировать отдельно, а не менять AES/session вслепую.

Рабочие серверы, удалённые БД, сессия, Vercel env, ключи, Yandex, 2GIS, очередь, scheduler, отзывы и Production в этой работе не менялись. Никаких live health/preflight/reconciliation/full-fetch запросов. Использовались только локальные копии и synthetic storage/HTTP boundaries. Полный QUALITY GATE / REGRESSION HARNESS не создавался.

## ASSIST-01. Reconciliation: от SQLSTATE до настоящего HTTP handler

Кандидат из предыдущего пакета встроен в существующий `requestDevServiceRpc` -> `createYandexConnectionReconciliation` -> `createReviewSyncWorkerHandler`.
Новый `lib/server/reconciliation-result.js` — только безопасная проекция результата, без I/O, ключей, нового RPC-клиента или бизнес-движка.
Распознаётся точное сочетание SQLSTATE 22023 и четырёх фиксированных сообщений установленной reconciliation-функции. Транспортное исключение с похожим code не считается доказанным бизнес-отказом. Доверенные ошибки отмечаются приватным WeakMap; HTTP вход/exception fields не могут сами назначить доверенную стадию.

До патча: реальный helper/client + synthetic PostgREST rejection -> HTTP error RECONCILIATION_FAILED.
После патча: тот же путь -> RECONCILIATION_NOT_ALLOWED / BUSINESS_REJECTED / NOT_APPLIED_BY_THIS_RPC.
При потере/повреждении ответа эффект остаётся UNKNOWN; changed=false не выдумывается. Нужные legacy success поля сохранены, дополнительные upstream поля не выводятся. HTTP 503 для отказа оставлен совместимым с текущим контрактом; смысл различается safe code/outcome.

SQL guard reconciliation НЕ расширен. YANDEX_CONTRACT_DRIFT по-прежнему нельзя сбрасывать после одного page1 health. Четыре SQL business-кода, NO-OP, success, неправильный SQLSTATE, таймаут, malformed success, auth/operation guards проверены через настоящий handler/helper/client; отдельный тест выполняет текущую SQL-функцию в локальном PGlite и подтверждает отсутствие изменений при отказе CONTRACT_DRIFT.

## ASSIST-02. Writer: безопасный код терялся во внешнем catch

В исходном requestDevServiceRpc writerErrors распознавались внутри try, но большинство из них отсутствовали в разрешённом списке catch. REVIEW_ROW_INVALID превращался в SERVER_SYNC_FAILED.
Исправлено сохранение заранее проверенного кода writer по фактическому RPC и SQLSTATE P0001/22023. Проверены REVIEW_BATCH_INVALID, REVIEW_ROW_INVALID, REVIEW_BATCH_DUPLICATE, REVIEW_RAW_PAYLOAD_INVALID. Raw details/hint/stack не возвращаются. Бизнес-правила writer не менялись.

## ASSIST-03. NULL в review_fail_sync_run

Добавлена НОВАЯ миграция:
`supabase/migrations/20260914190000_review_fail_sync_null_guard_08.sql`.
Исторические миграции не переписаны. Добавлено `p_error_code IS NULL` в исходную проверку. Scope, набор допустимых кодов, сигнатура, invoker, grants и штатные изменения run/connection сохранены.

Локальный PostgreSQL/PGlite тест выполняет настоящую старую и новую функции:
- старая принимает NULL и маркирует RUNNING как FAILED без причины;
- новая отклоняет NULL до mutation;
- пустой/неизвестный код, отсутствующие ID, чужая компания не меняют строки;
- service_role выполняет разрешённый отказ одного claimed run;
- повторное завершение запрещено;
- anon/authenticated запрещены;
- повторное применение миграции не меняет business rows;
- SECURITY INVOKER и пустой search_path сохранены.

Миграция НЕ применена в Supabase. В архиве отсутствует полный первоначальный migration baseline проекта: fixtures прямо обозначены как локальное подмножество. Нельзя накатывать весь каталог с нуля или «исправлять» расхождение исторических version IDs. Перед отдельным разрешённым remote migration требуется актуальный ledger/definition/grants preflight. Это не тест многопроцессной конкуренции native PostgreSQL: PGlite имеет один connection.

## ASSIST-04. Безопасные metadata — тоже данные

В исходной diagnose/inspect функции имена неизвестных JSON-полей возвращались дословно. Само имя поля может содержать приватные данные. Теперь выводятся известные ключи, фиксированный UNRECOGNIZED_KEY и отдельный count. Значения и неизвестные имена не выдаются.
Content-Type в single-page diagnostic нормализуется в фиксированную категорию; произвольный upstream header не возвращается.
`safeSchemaRule` теперь проверяет не только код и тип string, но точное соответствие code -> path/expected_type, закрытый набор actual_type и boolean present. Getters не выполняются. Известные легитимные правила, включая SESSION_COOKIE_EXPIRED, сохранены. Бизнес-валидация cookies/AES/expiry не менялась.

## ASSIST-05. Полная диагностика без изменения состояния

Старый `service.run(mode='dry_run')` НЕ read-only: он читает review snapshot, делает health transition, обновляет successful-sync metadata, а при ошибке может claim-ить alert. Он оставлен совместимым; нельзя использовать его под обещанием «DB writes=0».

Добавлен небольшой read-only режим существующего session service: `contractDiagnosticFull`. Он повторно использует `fetchYandexReviews`, `diagnoseYandexReviewsPayload`, существующий transport и session store; другого parser, writer, queue или review engine нет.
В том же защищённом route подготовлена отдельная explicit operation:

POST /api/internal/review-sync-worker
{"operation":"contract_diagnostic_full","expected_revision":13}

Это описание НОВОГО ЛОКАЛЬНОГО контракта, не команда к выполнению и не подтверждение deployed наличия. Число 13 — пример последней известной record revision; перед реальным запуском проверять фактическую revision и получить отдельное разрешение.

Ограничения:
- fixed Asbest scope; никакой caller-controlled org/company/URL;
- существующий Bearer auth, read-approval env и offline preflight;
- ожидаемая целая revision обязательна, session READY обязательна;
- чтение текущей revision перед каждой страницей и после выборки;
- максимум 5 последовательных GET (page 1..5), без retries/redirects;
- общий provider AbortSignal 30 секунд, на один запрос сохраняется максимум 10 секунд;
- отдельные RPC reads используют прежний 15-секундный timeout. Поэтому 30 секунд — provider deadline, НЕ гарантия максимальной wall-clock длительности всего HTTP handler;
- используются проверки total/limit/offset существующего full fetch;
- дубли/несовпадение unique count с total НЕ считаются полным PASS;
- при лимите страниц — отказ, не усечённый success;
- schema drift сообщает номер страницы, фиксированное поле и type/presence counts;
- не читает review snapshot, не пишет review/session/connection, не обновляет timestamps, не claim-ит alerts, не запускает worker/queue/scheduler;
- провал или PASS ничего не переводит в READY и не сбрасывает CONTRACT_DRIFT.

Проверены 67 synthetic отзывов на четырёх страницах, пустая выдача, ошибка третьей страницы, изменение total, дубли, отказ/redirect, malformed JSON, network failure, stale revision, storage failure, max-pages и запрет неподходящего state. Default deployed composition испытана с подменой только Fetch: реальные preflight, decrypt, handler, service, parser; разрешены только synthetic session read RPC + fake Yandex GET, никаких fake mutation RPC. Это не реальный вызов Яндекса и не доказательство устранения server CONTRACT_DRIFT.

## Тесты и фактические ограничения среды

Среда: Linux, Node v22.16.0, PGlite 0.5.8. PowerShell 7 отсутствует (`spawn pwsh -> ENOENT`). Установка внешнего бинарника не удалась; версия проекта/тестовые assertions не менялись ради зелёного отчёта. Внешняя сеть тестов блокировалась штатным no-network.mjs и дополнительным локальным LD_PRELOAD guard (только loopback для штатных mock HTTP tests). Реальные env не подгружались.

Исходный архив ДО патча: 377 total = 311 PASS + 56 FAIL + 10 SKIP.
Исправленная копия: 489 total = 423 PASS + 56 FAIL + 10 SKIP.
Списки 56 failed cases совпадают полностью и относятся к запуску отсутствующего pwsh. 10 SKIP предусмотрены ИСХОДНЫМИ тестами при ENOENT; новых skip/todo не добавлено. 112 дополнительных тестов PASS. Это не 489/489 PASS.

Целевой набор (новые проверки + затронутые существующие): 165 PASS / 0 FAIL / 0 SKIP.
Полный `npm run check` остановился на первом PowerShell parser call. Отдельно выполнены все 93 Node/JSON/inline-script проверки — PASS; 14 PowerShell parse checks — NOT_RUN.
`--test-concurrency=1`, native-host guard, исходные timeouts сохранены. package.json, package-lock и PowerShell scripts не менялись.

Проверка `git diff --check`, применимости patch на pristine baseline, source scan и checksum manifests — см. пакет evidence. Secret-pattern scan — ограниченная проверка известных literals, не доказательство отсутствия любых возможных секретов во всей истории Git.

## Что НЕ исправлено / не принято

- Реальный YANDEX_CONTRACT_DRIFT: нужна отдельно разрешённая полная диагностика после deployment и Windows gates.
- Состояние серверной connection не менялось; остаётся последним известным ERROR. Текущее READY session не перечитывалось в этой работе.
- Миграция NULL guard пока локальная.
- Provider recovery после полного diagnostic PASS не разрешён автоматически.
- Автономный scheduler/worker, lease/idempotency, multi-location model, matching/promo, auth/live AI, 2GIS и остальные AUD не объявлены закрытыми.
- Новая full diagnostic проверяет неподвижность доступных pagination признаков, но не доказывает snapshot isolation внешней живой ленты при неотличимом сдвиге.

## Минимальное продолжение

Применить готовый patch на точный f848d8b без потери локальных изменений, выполнить полный npm test/check в PowerShell 7 на Windows. При новом FAIL не deploy. Сохранить checkpoint. После этого отдельный согласованный Preview rollout; не менять production alias или env/keys. Лишь затем отдельное разрешение на один полный read-only diagnostic с актуальной revision/бюджетом. Запуск в этом чате не производился. Не нужно заново разрабатывать mapper или SQL-патч.

QUALITY GATE / REGRESSION HARNESS остаётся отдельным будущим блоком; не включён.
