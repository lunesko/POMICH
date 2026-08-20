# POMICH — полный аудит проекта

**Дата:** 2026-08-20  
**Репозиторий:** `github.com/lunesko/POMICH`  
**База аудита:** ветка `main` (`9a31995`)  
**Прод:** `https://pomich.help` / VPS `157.173.101.252`  
**Стек:** React 19 + Vite + Tailwind (SPA) · FastAPI (`bot/`) · Postgres + PostGIS · Telegram Mini Apps (2 бота)

> Скопируйте весь файл целиком. Ниже — единый отчёт: безопасность API, фронт, ops/CI, остаточные риски и приоритеты.

---

## 1. Краткий вердикт

Продукт уже имеет сильный каркас сессий (Bearer HMAC по ролям, привязка `sub` к path id, OTP с хешем кода, production startup guards). При этом на **`main` / текущем проде** остаются критичные дыры доступа к заказам и слабые bootstrap-секреты.

Открытый PR **#8** (`cursor/api-auth-hardening-ba71`, CI green) закрывает самые острые API-дыры (IDOR заказов, nearby pins, webhooks, admin-only `/providers`), но **ещё не смержен**. Даже после merge останутся: guest-session takeover, shared `POMICH_PROVIDER_TOKEN`, телефоны на публичной карте, CORS `*.trycloudflare.com`, хардкод секретов в `deploy.py`.

| Уровень | Кол-во | Суть |
|---------|--------|------|
| Critical | 5 | IDOR заказов (main), guest mint, shared provider token, хардкод секретов deploy, открытые Telegram webhooks (main) |
| High | 8 | CORS tunnel, OTP brute-force, enum телефонов, слабые пароли, map PII, токены в URL, SSE/WS, незакрытый create order без сессии (main) |
| Medium | 10 | Stateless sessions, health shallow, profile gate drift, CI Node drift, rate limits, docs stale |
| Low | 6 | OTP RNG, localStorage leftovers, docs IP, dead headers |

---

## 2. Что уже хорошо

- Bearer-сессии с привязкой identity: provider/customer path id должен совпадать с `sub`.
- Bootstrap-заголовки (`X-POMICH-*-Token`) в основном только для mint сессии, не для operational routes (кроме исключений ниже).
- OTP send: лимиты 3/10м + cooldown; код хранится как hash; verify через `compare_digest`.
- Accept offer: first-accept-wins в SQL; provider должен владеть offer.
- SQL: параметризованные запросы; опциональное Fernet для PII (`POMICH_ENCRYPTION_KEY`).
- Production guards: блокировка `CORS=*`, placeholder secrets, JSON store без явного allow.
- Docker multi-stage; `.dockerignore` исключает `.env*`; Postgres `service_healthy`; app HEALTHCHECK.
- Миграции: ledger `pomich_schema_migrations` в транзакции.
- CI: pytest + vitest + `tsc` + build + PostGIS smoke.
- Фронт: токены в `sessionStorage` (не `localStorage`); query `providerToken`/`adminToken` снимаются через `replaceState`; React без `dangerouslySetInnerHTML`.
- Telegram: initData HMAC + expiry; doctor не печатает токены ботов.

---

## 3. Статус PR #8 (auth hardening) — ещё не в `main`

**PR:** https://github.com/lunesko/POMICH/pull/8  
**Ветка:** `cursor/api-auth-hardening-ba71`  
**CI:** green (на момент аудита)

| Эндпоинт | На `main` (прод) | После merge #8 |
|----------|------------------|----------------|
| `GET /orders/{id}` | **открытый IDOR** | participant auth; 401 до existence probe |
| SSE/WS `/events\|ws/orders/{id}` | слабо / open | participant auth |
| `GET /map/orders/nearby` | фактически public | provider session |
| `POST /orders` | сессия опциональна | customer session / TG Mini App |
| `POST /telegram/*/webhook` | **без secret** | `TELEGRAM_WEBHOOK_SECRET` + header |
| `GET /providers` | полный список | admin only |

**Рекомендация:** смержить #8 в `main` и задеплоить до дальнейших фич. Остальные Critical ниже #8 не закрывает.

---

## 4. Critical

### C1. Открытый IDOR на заказ (`main`)
- **Где:** `bot/routers/orders.py` — `GET /orders/{order_id}` возвращает заказ без auth.
- **Риск:** любой, кто угадал/перехватил `ORD-…`, читает координаты, комментарий, статус, данные клиента/партнёра.
- **Фикс:** уже в PR #8 (`require_order_participant_auth`, auth before existence). Merge + deploy.

### C2. Guest session mint = захват чужого `guest-*`
- **Где:** `POST /auth/customer/guest/session` (`bot/routers/auth.py`) — клиент может передать свой `customerId` (`guest-*` или `customer-web`).
- **Риск:** знание id (из UI storage, логов, утечки) → новый bearer → чужие заказы, cancel, SSE.
- **Фикс:** всегда серверный UUID; не принимать client-supplied id; привязать к device/cookie; ускорить миграцию на phone/TG.

### C3. Shared `POMICH_PROVIDER_TOKEN` → сессия любого `providerId`
- **Где:** `POST /auth/provider/session` — один секрет + любой `providerId` → bearer партнёра.
- **Риск:** утечка токена = impersonation всех партнёров (offers, presence, nearby).
- **Фикс:** mint только для существующих/зарегистрированных; per-provider credentials; deprecate shared token; rate limit + audit log.

### C4. Хардкод прод-секретов в `deploy.py`
- **Где:** `deploy.py` → `create_env_production`:  
  `pomich-admin-secret-2026`, `pomich-provider-secret-2026`, plaintext пароли, `POSTGRES_PASSWORD=pomich-db-pass-2026`, `POMICH_ALLOW_HTTP_PILOT=true`, HTTP base URL.
- **Риск:** первый деплой / пересоздание `.env.production` получает предсказуемые секреты. `is_configured_secret()` их **не** режет (нет placeholder-фрагментов).
- **Фикс:** не генерировать секреты из репо; fail если env нет; rotate всё, что могло быть применено с этими значениями; добавить known-defaults в ban-list.

### C5. Telegram webhooks без secret (`main`)
- **Где:** `bot/routers/telegram.py` — POST webhook принимается без `X-Telegram-Bot-Api-Secret-Token`.
- **Риск:** подделка апдейтов → ложные сообщения/команды ботам.
- **Фикс:** в PR #8 (`require_telegram_webhook_secret`). На проде secret уже добавляли в `.env.production` в рамках hardening-работы — подтвердить после merge.

---

## 5. High

### H1. CORS всегда разрешает `*.trycloudflare.com` + credentials
- **Где:** `bot/fastapi_app.py` — `allow_origin_regex=r"https://.*\.trycloudflare\.com"`.
- **Риск:** любой Cloudflare Tunnel origin может делать credentialed запросы к API.
- **Фикс:** только non-prod или явный `POMICH_ALLOW_CLOUDFLARE_TUNNEL=true`; в production — выкл.

### H2. OTP confirm без лимита попыток
- **Где:** `bot/otp_verification.py` — send лимитирован, confirm — нет (6 цифр, TTL ~10м).
- **Риск:** online brute-force при известном `customer_id` / после phone-login send.
- **Фикс:** lock после N ошибок; backoff; invalidate code; IP rate limit.

### H3. Phone-login user enumeration
- **Где:** `POST /auth/customer/phone/login/send|confirm` → `404 customer_not_found` vs success.
- **Риск:** перебор, какие номера зарегистрированы.
- **Фикс:** одинаковый ответ/тайминг («если номер есть — код отправлен»).

### H4. Admin/provider password login: нет lockout; слабое хранение
- **Где:** `password_matches()` — plaintext или unsalted `sha256:`; аккаунты в env JSON.
- **Фикс:** Argon2/bcrypt; lockout; запрет plaintext в production; аккаунты в БД.

### H5. Публичная карта отдаёт телефоны партнёров
- **Где:** `GET /map/providers` — `_MAP_MARKER_KEYS` включает `phone`, `telegram`, `address` (`bot/routers/providers.py`); UI `RouteMap.tsx` показывает телефоны. `GET /providers/{id}/public` тоже с phone.
- **Риск:** скрейпинг PII / спам; усиливает discovery id для C3.
- **Фикс:** на публичной карте — имя/рейтинг/локация/kind; телефон только после accept или authenticated card. Directory OSM phones — отдельно помечать как публичные.

### H6. Токены в query string
- **Где:** bootstrap `?providerToken=` / `?adminToken=` (`src/lib/auth.ts`); realtime `?access_token=` (`src/lib/realtime.ts`, EventSource).
- **Риск:** history, Referer, proxy/CDN logs.
- **Фикс:** one-time exchange / fragment; short-lived stream tickets; cookie для SSE/WS.

### H7. SSE/WS: lookup заказа до auth (даже после #8 частично)
- **Где:** `bot/routers/events.py`, `ws.py` — на main open; в #8 auth есть, но порядок «сначала get_order» может оставить oracle существования.
- **Фикс:** как у hardened GET order: bearer first, затем load; единый ответ для non-participant.

### H8. `POST /orders` без обязательной сессии (`main`)
- **Где:** create_order — customer principal optional (кроме telegram-mini-app path).
- **Риск:** спам заказов, подстановка чужих identity fields.
- **Фикс:** в PR #8 — требовать customer session / verified TG. На main — срочно.

### H9. Uzhhorod import принимает raw admin bootstrap header
- **Где:** `POST /admin/providers/import/uzhgorod` — fallback на `X-POMICH-Admin-Token`.
- **Фикс:** только admin bearer; убрать raw-token fallback.

### H10. (Frontend) Несогласованность «профіль завершено»
- **Где:** `ProviderFlow.isPartnerRegisteredAndCompleted` требует plate; `ProviderCabinet.isProviderProfileIncomplete` — нет; `pomichPartnerRegistered:*` в localStorage переживает logout.
- **Риск:** UI duty vs cabinet расходятся; stale flag → skip registration.
- **Фикс:** одна shared-функция; clear flag on logout; **сервер** должен enforce completeness перед online.

---

## 6. Medium

| ID | Тема | Где / суть | Рекомендация |
|----|------|------------|--------------|
| M1 | Stateless HMAC sessions | нет revoke; TTL 86400 | shorter TTL + refresh; denylist `jti` |
| M2 | TG initData None → soft-open | если боты не сконфигурированы | fail closed в production |
| M3 | `GET /telegram/session/{chat_id}` | open при отсутствии TG config | требовать initData; 503 если TG off |
| M4 | Нет security headers | нет HSTS/CSP/XFO в app | nginx/CF или Starlette middleware |
| M5 | `.env.example` с реальным SSH host | `157.173.101.252` | placeholder IP |
| M6 | Timing-unsafe bootstrap compares | `!=` вместо `compare_digest` | hmac.compare_digest |
| M7 | Нет global rate limit | кроме OTP send | edge limits на `/auth/*`, `/orders`, `/map/*` |
| M8 | Health без DB | `bot/routers/health.py` | readiness: DB/PostGIS + migration version |
| M9 | `getProviders()` без auth на клиенте | `src/api/client.ts`; API станет admin-only после #8 | убрать fallback; checklist обновить |
| M10 | CI Node 20 vs Docker/mise 22 | `.github/workflows/ci.yml` | выровнять версии |
| M11 | `forwarded-allow-ips='*'` | `start.sh` | ограничить CIDR прокси |
| M12 | `start.sh` polling только на `TELEGRAM_BOT_TOKEN` | dual-bot vars игнорируются | стартовать при любом bot token |
| M13 | Миграции INDEX в транзакции | крупные таблицы → locks | CONCURRENTLY / maintenance window |
| M14 | Устаревшие docs | `UX_UI_CURRENT_SCENARIOS.md` (dispatch retry), `RELEASE_CHECKLIST.md` (public `/providers`) | синхронизировать с кодом |

---

## 7. Low

| ID | Тема | Рекомендация |
|----|------|--------------|
| L1 | OTP через `random.randint` | `secrets.randbelow` |
| L2 | Dead `X-POMICH-*-Token` params на routes | убрать из сигнатур (кроме mint) |
| L3 | `/health` → telegramQueue stats | урезать public health |
| L4 | Identity leftovers в localStorage | не критично; не хранить verification blobs |
| L5 | XSS | поверхность низкая; не вставлять user HTML в Leaflet icons |
| L6 | Маскировка номера авто клиенту | опционально до en_route |

---

## 8. Инвентарь эндпоинтов (состояние после ожидаемого merge #8)

Маршруты дублируются: `/…` и `/api/…`.

### Public / слабо защищённые
| Method | Path | Примечание |
|--------|------|------------|
| GET | `/health` | public |
| GET | `/map/providers`, settlements | public; телефоны — H5 |
| GET | `/providers/{id}/public` | public card + phone |
| POST | `/auth/customer/guest/session` | **C2** |
| POST | `/auth/customer/phone/login/*` | enum — H3 |
| POST | `/auth/admin/login`, `/auth/provider/login` | H4 |
| POST | `/auth/admin/session`, `/auth/provider/session` | bootstrap secrets — C3/C4 |
| POST | `/telegram/*/webhook` | после #8 — secret required |

### Customer bearer
`POST /orders` · profile/verify · account/role · order cancel/confirm-price/reviews · self provider session · order GET если owner · customer SSE/WS

### Provider bearer
`GET /map/orders/nearby` · profile/presence/offers/accept · order status · order GET если assigned · provider SSE/WS

### Admin bearer
`GET /orders`, `GET /providers` · `/admin/*` · verification reviews · status patches

---

## 9. Frontend

| Тема | Оценка |
|------|--------|
| Хранение сессий | `sessionStorage` + expiry — ок для SPA; XSS = полный компромисс → целиться в httpOnly cookies |
| Query bootstrap tokens | читаются и снимаются из URL — лучше one-time POST |
| Realtime `access_token` | EventSource limitation — short-lived tickets |
| Map phones | UI показывает то, что отдаёт API — чинить на бэке (H5) |
| XSS | нет `dangerouslySetInnerHTML`; React escape — хорошо |
| Partner completeness | Flow ≠ Cabinet; localStorage flag — H10 |
| `getProviders` без auth | сломается/молчит после #8 — M9 |

---

## 10. Ops / Deploy / CI

| Тема | Оценка |
|------|--------|
| `deploy.py` | **C4** — хардкод секретов, AutoAddPolicy, root SSH, HTTP pilot |
| Docker compose prod | postgres healthy + app healthcheck — ок; health shallow — M8 |
| Secrets in git | `.gitignore` `.env*` — ок; defaults в `deploy.py` — плохо |
| CI | полный suite + PostGIS — ок; Node drift — M10; нет secret scan / deploy gate |
| Telegram | webhook fail-closed после #8 — хорошо; polling start.sh — M12 |
| Docs | `TELEGRAM_RUNTIME.md` сильный; scenarios/checklist местами stale |

---

## 11. Приоритетный план работ

### P0 — сейчас
1. **Merge + deploy PR #8** (IDOR, nearby, webhooks, admin `/providers`, create order auth).
2. **Ротация** admin/provider/customer/DB секретов, если когда-либо ставились из `deploy.py` defaults.
3. Убрать/запретить хардкод defaults в `deploy.py` + ban-list в `is_configured_secret`.

### P1 — следующая итерация
4. Guest session: только server-generated id (C2).
5. Сузить/убрать shared `POMICH_PROVIDER_TOKEN` (C3).
6. Выключить Cloudflare CORS regex в production (H1).
7. OTP confirm lockout + phone-login anti-enum (H2/H3).
8. Убрать телефоны live-партнёров с `/map/providers` (H5).

### P2 — укрепление
9. Токены не в query (H6); SSE/WS auth order (H7).
10. Argon2 + login lockout (H4); убрать uzhgorod raw token (H9).
11. Единый partner completeness + server enforce online (H10).
12. Rate limits, security headers, deep health, CI Node align, docs sync.

---

## 12. Матрица «закрыто / открыто»

| Риск | main/prod | после #8 | остаётся |
|------|-----------|----------|----------|
| Читать чужой заказ по id | открыто | закрыто | — |
| Nearby searching pins анонимно | открыто | закрыто | — |
| Telegram webhook spoof | открыто | закрыто* | *нужен secret в env |
| Полный GET /providers | открыто | admin | — |
| Guest id takeover | открыто | открыто | да |
| Shared provider bootstrap | открыто | открыто | да |
| deploy.py default secrets | в репо | в репо | да |
| Map partner phones | открыто | открыто | да |
| Cloudflare CORS regex | вкл | вкл | да |
| OTP confirm brute-force | открыто | открыто | да |

\* На проде secret для webhook мог быть уже прописан вручную во время hardening — сверить `.env.production` после merge.

---

## 13. Файлы-якоря для ревью

```
bot/api_deps.py              # auth deps, secrets, sessions
bot/routers/auth.py          # guest/provider/admin mint, OTP login
bot/routers/orders.py        # IDOR / create auth
bot/routers/providers.py     # map markers, nearby, list
bot/routers/events.py / ws.py
bot/routers/telegram.py
bot/otp_verification.py
bot/fastapi_app.py           # CORS
deploy.py                    # hardcoded secrets
src/lib/auth.ts              # sessionStorage, query tokens
src/lib/realtime.ts          # access_token in URL
src/components/provider/ProviderFlow.tsx
src/api/client.ts
.github/workflows/ci.yml
docker-compose.production.yml
```

---

## 14. Итог одной строкой

**Смержить #8 и задеплоить → сразу закрыть guest-mint и shared provider token → убрать телефоны с публичной карты и дефолты из `deploy.py`.** После этого продукт переходит из «бета с критичными API-дырами» в «осознанный hardening backlog».

---

*Аудит выполнен по коду репозитория (read-only review + сверка с PR #8). Не является penetration test против живого продакшена сверх ранее проверенных auth-hardening проб.*
