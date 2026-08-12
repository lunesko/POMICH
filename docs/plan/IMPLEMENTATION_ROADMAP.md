# POMICH — План реализации

**Дата:** 12.08.2026  
**Репозиторий:** [lunesko/POMICH](https://github.com/lunesko/POMICH)  
**Локально:** `Проекты/POMICH`  
**North Star:** **Time To Rescue** — от создания заявки до прибытия реальной помощи.

> Мы строим не каталог эвакуаторов и не карту.  
> Мы строим **dispatch infrastructure**, которая превращает roadside incident в назначенную и отслеживаемую помощь.

---

## 0. Что уже есть в коде (не начинаем с нуля)

Текущий статус — **MVP 0.5 / Beta Foundation** (см. `docs/BETA_FOUNDATION.md`).

| Слой | Готово |
|------|--------|
| Frontend | React + Vite + Tailwind, Leaflet/OSM, Customer / Partner / Admin UI |
| Backend | FastAPI, same-origin `/api/*`, production guards |
| Storage | JSON (dev) + SQL/PostgreSQL + PostGIS candidate search |
| Dispatch | online + verified + capability + radius + TTL; **first-accept-wins** в SQL-транзакции |
| Auth | Bearer sessions: customer / provider / admin; Telegram `initData` |
| Telegram | Mini App + bot polling; заказы через тот же `/api/orders` |
| CI | pytest, vitest, tsc, production build, PostGIS smoke |
| OpenRoadAid | отдельный reference layer: matcher, incidents/offers/jobs, simulator |
| Домен | услуги `tow/battery/wheel/fuel/lockout/mechanic`, pricing/ETA, статусы заказа |

**Не делать сейчас:** Redis, K8s, Kafka, микросервисы, WebSocket-first, AI matching, Google Maps SDK, сложные платежи, native apps.

---

## 1. Продуктовая формула (якорь всех решений)

```text
ПРОБЛЕМА → ГЕО → DISPATCH → ПОДХОБНИКИ → ПЕРВЫЙ ACCEPT → ASSIGNED
  → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED
```

Каждая фича проходит фильтр:

1. Сокращает ли **Time To Rescue**?
2. Повышает ли доверие, что помощь реально приедет?
3. Делает ли жизнь исполнителя проще (онлайн, оффер, lifecycle)?

Если нет — откладываем.

---

## 2. Дорожная карта по фазам

### Фаза A — Pilot City Gate (сейчас → первые реальные заказы)

**Цель:** 1 город · ~10 исполнителей · первые 100 реальных заявок.

| # | Задача | Результат | Приоритет |
|---|--------|-----------|-----------|
| A1 | Staging на одном HTTPS origin (`staging.pomich.help` или tunnel) | Frontend + `/api` без localhost | P0 |
| A2 | Production compose: Postgres/PostGIS, restart, healthcheck, CORS exact | Стабильный runtime | P0 |
| A3 | Public smoke: 2 providers online → order → dual offers → first-accept → COMPLETED | Доказанный race gate | P0 |
| A4 | Playwright E2E на staging (тот же сценарий в браузере) | Release gate | P0 |
| A5 | Онбординг Partner: «Вийти на лінію», heartbeat, оффер Accept | Исполнитель живёт в продукте | P0 |
| A6 | Customer flow UX: проблема → гео → цена/ETA → вызов → трекинг | Один mobile-first сценарий | P0 |
| A7 | Telegram Mini App: phone share, история заказов клиента | Тот же UX через бота | P1 |
| A8 | Persistent accounts (provider/admin) вместо env-only | Не теряем доступы при рестарте | P1 |
| A9 | TTR метрики на заказ: created_at → assigned → arrived | Считаем north star с первого дня | P0 |
| A10 | Backup/export orders + providers + events | Не теряем пилотные данные | P1 |

**Критерий выхода из фазы A:**  
реальный эвакуатор принял реальный заказ, клиент увидел статусы до COMPLETED, TTR записан.

---

### Фаза B — Automatic Dispatch (умный матчинг в одном городе)

**Цель:** не «ближайший», а **лучший** исполнитель для ситуации.

| # | Задача | Детали |
|---|--------|--------|
| B1 | Scoring v1 | capability + distance + online TTL + load + accept rate |
| B2 | Offer fan-out | топ-N кандидатов, TTL оффера, cascade если никто не принял |
| B3 | ETA realism | OSRM/Valhalla позже; на старте Haversine + калибровка по факту |
| B4 | Reputation seed | on-time arrival %, cancel rate, completion rate |
| B5 | Pricing transparency | цена до вызова, без сюрпризов после приезда |
| B6 | Demand/Supply heatmap (internal) | где ломаются / где дырки в покрытии |

**Связь с OpenRoadAid:**  
алгоритм matching выносить в общий язык `incident → capabilities → matching → offer → assignment`, чтобы POMICH оставался продуктом, а OpenRoadAid — протоколом.

**Критерий выхода:**  
средний TTR падает относительно фазы A; доля «оффер принят < X сек» растёт.

---

### Фаза C — Marketplace Ukraine

**Цель:** 1000+ заявок → несколько городов → вся Украина.

| # | Задача |
|---|--------|
| C1 | Верификация исполнителей (документы, фото техники, capabilities) |
| C2 | Мультисервисная сеть: tow, battery, wheel, fuel, lockout, mechanic |
| C3 | Комиссия + payout модель (простая, понятная партнёру) |
| C4 | Admin ops: модерация, ручной reassign, dispute |
| C5 | PWA install + push (когда polling уже не хватает) |
| C6 | Rate limit, monitoring, alerting, audit log |
| C7 | Customer login вне Telegram (телефон / OTP) |

**Критерий выхода:**  
устойчивый marketplace в нескольких городах, сеть сама генерирует повторяемые заказы.

---

### Фаза D — Platform & Integrations

**Цель:** POMICH становится слоем, а не только приложением.

```text
Google Maps / Waze / OEM / Insurance / Fleet / Telematics
                      ↓
                 OpenRoadAid
                      ↓
                   DISPATCH
                      ↓
              Provider Network
                      ↓
                    RESCUE
```

| # | Задача |
|---|--------|
| D1 | Стабильный OpenRoadAid API (incident/job/offer/event) |
| D2 | Partner API / webhooks для страховых и ассистанс-компаний |
| D3 | Automotive / OEM hooks (BATTERY_FAILURE + location + vehicle) |
| D4 | Pricing intelligence + demand/supply maps как продукт |
| D5 | Экспорт модели в другие страны |

---

## 3. Архитектура, которую держим

```text
Browser PWA ──────── Telegram Mini App
      │                     │
      └──────────┬──────────┘
                 │ HTTPS (один origin)
              FastAPI
        ┌────────┼────────┐
      Auth    Dispatch   Orders
        └────────┼────────┘
         PostgreSQL + PostGIS
                 │
        geo candidates → offers → first-accept-wins → events/TTR
```

- Карта = UI инфраструктуры (OSM + Leaflet), не продукт.
- Навигацию не изобретаем; dispatch — наш слой.
- Один frontend для Web/PWA/Telegram.

---

## 4. Рабочий порядок на ближайшие 2–4 недели

Неделя за неделей — только то, что двигает к первому реальному rescue.

### Неделя 1 — Staging + Gate
1. Поднять staging (Docker production compose + PostGIS).
2. Пройти `RELEASE_CHECKLIST.md` smoke.
3. Зафиксировать TTR поля в `order_events`.
4. Закрыть A1–A4.

### Неделя 2 — Partner reality
1. Довести Partner: online / heartbeat / Accept / lifecycle.
2. Онбордить 3–10 реальных исполнителей (1 город).
3. Прогнать controlled live order (не демо-мок).
4. Закрыть A5, A9, частично A6.

### Неделя 3 — Customer trust
1. Упростить customer happy-path до минимума кликов.
2. Telegram: phone + история.
3. Прозрачная цена до вызова.
4. Закрыть A6–A7, начать B5.

### Неделя 4 — Learn from TTR
1. Разобрать первые 10–30 заказов: где теряется время.
2. Scoring v0.1 (даже простой вес distance+accept_rate).
3. Backup + persistent accounts.
4. Решение: идём в Фазу B или ещё пилим Pilot.

---

## 5. Роли продукта (что строим параллельно)

| Поверхность | Кто | Главный сценарий |
|-------------|-----|------------------|
| **POMICH Customer** | водитель | проблема → помощь едет |
| **POMICH Partner** | исполнитель | на лінії → Accept → lifecycle |
| **POMICH Admin** | оператор | мониторинг, trust, reassign |
| **OpenRoadAid** | платформа | протокол incident→rescue |

Не плодим десяток UI. Один mobile-first продукт, разные роли.

---

## 6. Метрики успеха

| Метрика | Зачем |
|---------|--------|
| **TTR p50 / p90** | north star |
| Offer accept latency | скорость сети |
| Assignment success rate | есть ли кто принять |
| No-show / cancel after accept | доверие |
| Completed orders / week | реальность > демо |
| Providers online hours | supply |
| Repeat customer rate | ценность |

---

## 7. Definition of Done для «первого POMICH»

Считаем, что первый настоящий POMICH состоялся, когда одновременно верно:

- [ ] Публичный HTTPS origin без localhost в Network
- [ ] ≥ 1 город, ≥ 3 verified providers online
- [ ] Клиент создал заказ с телефона / Mini App
- [ ] ≥ 1 provider получил оффер и принял
- [ ] Статусы дошли до ARRIVED и COMPLETED
- [ ] TTR по заказу посчитан
- [ ] Это был реальный автомобиль и реальный исполнитель

Один такой заказ ценнее сотни мокапов.

---

## 8. Связанные документы

- Манифест (EN): `docs/POMICH_MANIFESTO.md`
- Манифест (UA/RU): `docs/plan/MANIFESTO.ru.md`
- Beta foundation: `docs/BETA_FOUNDATION.md`
- Release: `RELEASE_CHECKLIST.md`
- Deploy: `DEPLOYMENT.md`
- Telegram: `TELEGRAM_RUNTIME.md`
- Audit: `PRE_PRODUCTION_AUDIT.md`
- OpenRoadAid: `openroadaid/README.md`

---

## 9. Следующий конкретный шаг

**Сейчас:** закрыть Pilot Gate (Фаза A) — staging + smoke + Playwright + TTR + первые партнёры.

Не начинать Фазу D и не раздувать OpenRoadAid, пока нет реальных TTR-данных из пилота.
