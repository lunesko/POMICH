## Контекст POMICH
Источник: lunesko/POMICH, commit 6881daff2a079c9455c9db35c12e296c751bc5bc, проверен 25.10.2026.
Подтверждено README, package.json, CI, AGENTS.md и началом bot/order_store.py: React 19, TypeScript, Vite 8, Tailwind 4, Leaflet; FastAPI/Python; production PostgreSQL/PostGIS. JSON-хранилище — dev/test fallback, его проверки не заменяют SQL-интеграцию.
HTTP routers: bot/routers/. Логика заказов: bot/order_store.py; SQL storage: bot/runtime_store.py; геодиспетчеризация настраивается через bot/dispatch_config.py. Realtime имеет SSE/polling в README; в дереве есть WS-модули. Выбор транспорта в конкретном пути проверяй по коду и конфигурации, не обещай WS или масштабирование по наличию файла.
Текущие статусы включают draft, searching, accepted, price_confirmed, assigned, en_route, arrived, in_progress, completed, cancelled. Разрешённые переходы извлекай из обработчиков: множество статусов не равно графу переходов. Не заменяй цикл старой упрощённой схемой из памяти.
Есть шаг подтверждения цены клиентом после принятия партнёром. Сохраняй его при изменениях назначения. Presence TTL в просмотренном модуле — 60 секунд; сверяй override и фактический heartbeat.
Надёжность означает реальное сопровождение помощи: нет исполнителей, исполнитель пропал, неверная GPS-точка, потеря сети, восстановление заявки, изменение ETA, помощь не оказана. Не обещай точное ETA без источника и времени обновления.
Пользователь отложил миграцию на Java. Сохраняй FastAPI. UI: единые шрифты и компоненты, иконки вместо emoji, понятные украинские тексты. Существующие юридические тексты и согласие не ломать.
Корневой AGENTS.md содержит контекст Figma Make и утверждение о запущенном Vite. Это не подтверждение текущей среды: фактический сервер и пути проверять.

## Команды и доказательства
Из README/package/CI: npm test; npx tsc --noEmit; npm run build; python -m pytest; npm run test:e2e.
Дополнительные существующие проверки: npx playwright test --config playwright.production.config.ts; npx playwright test --config playwright.backend.config.ts; python scripts/postgis_smoke.py.
Проверки PostGIS требуют отдельной тестовой БД и конфигурации из CI. Не подключай их к production DATABASE_URL. Не копируй создание БД из CI без проверки изоляции.
Зависимости устанавливать по lock-файлам проекта. Просмотренный CI содержит автоматический production deploy при push main: работай в отдельной ветке и учитывай этот побочный эффект.
