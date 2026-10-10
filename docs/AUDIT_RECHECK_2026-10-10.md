# Повторная проверка аудита POMICH от 09.10.2026

Дата проверки: 10.10.2026. Репозиторий: `M:\POMICH`, ветка `main`.

## Вывод

Выполнен `git pull --ff-only`: `1a2df96` → `52742b7e2715ad18e1a615781395e2d534ca3797`. HEAD совпадает с origin/main и **с SHA, уже проверенным в исходном HTML-аудите**. Исправлений после этого аудита в main не получено. Закрытие ни одного из F01–F21 не подтверждено. F01 остаётся блокером выпуска; F01–F04 повторно воспроизведены локально.

Указанного пользователем пути `POMICH\_Audit\_2026-10-09.html` нет. Найден и прочитан `C:\Users\marty\Downloads\Telegram Desktop\POMICH_Audit_2026-10-09.html`, содержащий F01–F21 и вышеуказанный SHA.

Незакоммиченный `CODE_REVIEW.md` сохранён без изменений. Код приложения при аудите не исправлялся. Production-заявки, настройки GitHub и сервер не изменялись.

## Матрица F01–F21

| ID | Приоритет | Статус | Повторная проверка / доказательство |
|---|---|---|---|
| F01 | P0 | Не исправлено, воспроизведено | `bot/routers/orders.py:61` принимает dict и сохраняет id; `bot/order_store.py:687` сохраняет переданный id; `bot/runtime_store.py:609` обновляет по id без прежнего owner. POST клиента B перезаписал SQL-заказ клиента A, HTTP 201. |
| F02 | P1 | Не исправлено, воспроизведено | В `create_order` проверки зависят от входных source/status. POST с source=web, status=completed и без координат принят; статус completed сохранён. |
| F03 | P1 | Не исправлено, воспроизведено | `bot/field_encryption.py`, `_get_fernet` подавляет исключение; `encrypt_field` возвращает исходное значение. Неверный ключ `not-a-valid-fernet-key` дал plaintext. |
| F04 | P1 | Не исправлено, воспроизведено | `bot/routers/auth.py:295`: logout удаляет cookie. После HTTP 204 скопированный bearer читает профиль с HTTP 200, скопированная cookie восстанавливает сессию с HTTP 200. |
| F05 | P1 | Не исправлено в коде | `src/lib/realtime.ts:40,49`: общий access_token записывается в URL. Настройки логов фактического production не проверены. |
| F06 | P1 | Не исправлено в коде | `bot/realtime.py:131,162`: бесконечные WS/SSE циклы не получают principal/deadline и не проверяют отзыв/expiry. Долгий live stream не запускался. |
| F07 | P1 | Не закрыто | requirements.txt не изменился относительно HTML-аудита; Python SCA gate отсутствует. Новый npm audit: 2 high + 2 moderate entries; production npm: 0. Старые числа pip-audit не выдаются за новый результат: Python SCA повторно не запускался. |
| F08 | P1 | Не исправлено, GitHub API | `gh api .../branches/main`: protected=false. Ruleset «Protect your most important branches»: enforcement=disabled. |
| F09 | P1 | Не закрыто, код и GitHub | Запуск 37955648440 того же SHA завершился failure; повторно прочитанный лог: `ERROR: POMICH_SSH_HOST is required`. `scripts/deploy_remote.sh:51,88` использует /api/health. Успешный CI run 37915039654 не доказывает production deployment. |
| F10 | P1 | Требует повторной браузерной проверки | Новых изменений кода после исходного наблюдения нет. Этот аудит не воспроизводил live CSS failure; нельзя утверждать, что сейчас CSS не работает у пользователей. |
| F11 | P1 | Не исправлено в коде | `bot/telegram_outbound.py:17`: process-local queue.Queue. Durable outbox в полученном обновлении не добавлен. |
| F12 | P2 | Не исправлено в коде | `bot/realtime.py`: локальные _CHANNELS/_LOOPS; stats прямо описывает single-worker bus. |
| F13 | P2 | Не исправлено в проверенных endpoints | `create_order(payload: dict)`, auth/profile handlers продолжают принимать dict; строгого DTO создания с extra=forbid нет. |
| F14 | P2 | Не закрыто | Крупные order_store/runtime_store/CustomerFlow/ProviderFlow остались; полной декомпозиции в полученном diff нет. Наличие выделенных routers не закрывает этот пункт. |
| F15 | P2 | Не исправлено в коде | `bot/runtime_store.py:187–218`: get_engine вызывает _install_schema, затем create_all и миграции. |
| F16 | P1 | Не исправлено в тестах | `e2e/ux-accessibility.spec.ts`: API requests abort; три UI-сценария. playwright.config.ts: только mobile/desktop Chromium, serviceWorkers=block. Реальной цепочки с PostgreSQL нет. |
| F17 | P2 | Не закрыто | Dockerfile без USER; runtime на node:22-bookworm; pytest в production requirements. Полное усиление image/supply chain не выполнено. |
| F18 | P2 | Не исправлено в коде | `src/lib/osrmRoute.ts:14,58`, `reverseGeocode.ts:53,166`: прямой fetch к OSRM/Nominatim без deadline. |
| F19 | P2 | Закрытие не подтверждено | Код того же SHA; новых retention/export/deletion изменений относительно исходного аудита нет. Фактические процедуры оператора не проверялись. |
| F20 | P2 | Не исправлено в конфигурации | `deploy/nginx/pomich.help.conf:62,71`: script-src unsafe-inline, connect-src https: wss:. Фактические live headers заново не проверялись. |
| F21 | P2 | Не исправлено в create path | `create_order` → `save_order` → upsert: отдельного Idempotency-Key, principal/key deduplication и payload hash нет. Клиентский id не является безопасной заменой. |

## Локальные воспроизведения

Использованы синтетические guest-сессии, TestClient FastAPI и отдельная временная SQLite-база. Локальный .env отключён через POMICH_SKIP_LOCAL_ENV, Telegram notifications подменены, данные production не использовались. SQL engine закрыт; временная база удалена автоматически.

```json
{"F01_F02_http":201,"owner_changed_to_B":true,"status":"completed","coordinates_absent":true}
{"F03_plaintext":true}
{"F04_logout":204,"copied_bearer":200,"copied_cookie_restore":200}
```

Это повторное доказательство общей SQL-ветки, а не прогон на PostgreSQL. Для приёмки исправления F01 нужны также PostgreSQL-регрессии с внешними ключами и конкурентными запросами. F03 проверен на уровне encrypt_field; production startup validator отдельно не воспроизводился.

## Что действительно вошло в обновление

`docs/AUDIT_FIXES_2026-10-09.md` ссылается на более ранние UX/UI-аудит 08.10, code audit 06.10 и review PR #94. Это не отчёт о закрытии F01–F21 из предоставленного HTML.

Обновление содержит восстановление browser session, remember-me, общий механизм renewal токенов, сохранение черновика, подтверждение destination, уточнения GPS/каталога/цены, UI cookie notice, повтор OTP и thread-safe доставку realtime внутри процесса. В репозитории есть соответствующие новые тесты. Эти улучшения полезны, но renewal не равен revocation, thread safety не равна межпроцессному broker, OTP retry не равен durable outbox.

## Проверки

- Backend: `python -m pytest tests openroadaid/tests -q` — **257 passed**, 50.96 s.
- Frontend: `npm test` — **51 файлов, 387 passed**, 54.30 s. Были предупреждения jsdom о navigation, тесты не упали.
- `npm audit --json`: **4 entries**, 2 high / 2 moderate. `npm audit --omit=dev --json`: **0**. Это результаты базы advisories для lockfile, не доказательство эксплуатации.
- Первый TypeScript/build запуск выявил несинхронизированный локальный node_modules: отсутствует объявленная зависимость web-vitals. После успешного `npm ci --no-audit --no-fund` повторные `npx tsc --noEmit` и `npm run build` завершились с exit code 0. Это была проблема локального окружения, а не новый дефект исходников.
- E2E, PostgreSQL, live CSS, реальные OTP/GPS/dispatch, устройства, backups и production secrets в этой повторной проверке не тестировались. Исходные утверждения об этих поверхностях не считаются заново подтверждёнными.
- Git pull сообщил, что git-lfs отсутствует в PATH. Поиск LFS pointer headers среди public/data PNG/ICO/JSON совпадений не нашёл; это не полная проверка всех LFS assets.

## Очерёдность исправлений

1. F01/F02: серверный id, INSERT-only create, строгий DTO, начальный status от сервера, одинаковые backend guards. Регрессии двух владельцев и запрещённых серверных полей на PostgreSQL.
2. F03/F04: fail-closed encryption и серверный отзыв session family; copied-cookie/bearer тесты.
3. F05/F06: безопасные channel tickets и закрытие realtime при expiry/revoke.
4. F07/F08/F09/F10/F16: зависимости и Python SCA, обязательный CI/review, рабочий deployment с readiness/assets/browser checks, полноценные backend E2E.
5. Durable outbox, multi-worker transport при масштабировании, отдельные миграции и остальные P2.

Зелёные существующие тесты не отменяют воспроизведённый P0. До закрытия F01–F04 готовность к расширению пилота не подтверждена.
