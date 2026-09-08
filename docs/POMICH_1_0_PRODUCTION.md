# POMICH 1.0 — Production

**Дата:** 2026-09-08  
**Источник:** аудит Romchik FFG + текущий код `pomich.help`  
**Статус сейчас:** Prototype/MVP → цель **POMICH 1.0 Production**  
**Пилот:** Ужгород · 10–20 партнёров · 100 реальных заявок  

---

## 1. Чем является продукт

> **POMICH — платформа швидкої допомоги автомобілістам на дорозі.**

Не каталог эвакуаторов. Механика как Bolt/Uber: запрос → подходящие рядом → accept → трекинг → работа → оплата → рейтинг.  
Отличие — тип услуги (roadside), не такси.

**North Star в админке:** «Допомогли N водіям»  
**Главный KPI:** Successful Assistance Rate = completed / created  
Далее: Time to Match · Time to Arrival · Cancellation Rate · Repeat Rate

---

## 2. Услуги 1.0 (на главном экране)

| Ключ | Текст для клиента («Що сталося?») |
|------|-----------------------------------|
| `tow` | Евакуатор |
| `battery` | Не заводиться |
| `wheel` | Пробило колесо |
| `fuel` | Закінчилось пальне |
| + | Інша проблема (`lockout`, `mechanic`, …) |

Позже (не на Home): замкнулось авто, перегрів, дрібний ремонт, витягнути, ДТП, інше.

---

## 3. P0 — до реального запуска (закрыть до пилота)

### Client
1. Emergency Home: «Що сталося?» — 4 крупные карточки + «Інша проблема»
2. Место: авто-гео → підтвердити / вказати pin вручну
3. Мини-детали авто (не анкета на 15 полей)
4. Цена/диапазон **до** «Знайти допомогу»
5. Режим SEARCHING (зона, партнёры nearby, радиус 5→10→20→40)
6. MATCH FOUND: фото, рейтинг, авто, номер, ETA, дзвінок/чат, share trip
7. ARRIVED / IN_PROGRESS / COMPLETED + рейтинг
8. OTP по телефону без «регистрация → пароль → email»
9. `NO_PROVIDER_FOUND` + расширить поиск / диспетчер / скасувати
10. ДТП: «Є постраждалі?» → 112, POMICH не подменяет экстренные службы

### Partner
11. Онбординг: телефон, ФИО/ФОП, фото, документы, авто, номер, услуги, зона, банк
12. KYC статусы: pending → verified (без verified — не на линию для real money)
13. Home: Offline / **Вийти на лінію** / онлайн-сводка
14. Карточка оффера (услуга, км, авто, проблема, ETA, ~₴) · Прийняти / Відхилити · timeout ~15с
15. Capabilities (`TOW|BATTERY|TIRE|FUEL|LOCKOUT|MECHANIC|RECOVERY`) — оффер только подходящим

### Dispatch / backend
16. Scoring: distance + ETA + rating + accept/completion rate + service/vehicle match + status
17. Presence: ONLINE / BUSY / OFFLINE / PAUSED + last_location(+at, accuracy, heading, speed); live в Redis geo, persist в PostGIS
18. Offer timeout → reassignment
19. Жёсткая order state machine на сервере
20. Server-side pricing module (`PaymentProvider` / статусы даже при cash)
21. Cancellation, rating, reviews, order/partner history
22. Rate limiting, audit log, monitoring, backups, readiness

### Trust / legal / admin
23. Trust badges на карточке партнёра
24. Admin = Operations: live map, manual assign/reassign, call, cancel, price, refund, block
25. Privacy / Terms / Partner Agreement / Safety page

### SEO (отдельный публичный слой)
26. Индексируемые страницы услуг и городов (не только SPA)
27. metadata, robots, sitemap, OG, structured data, PWA icons/manifest

---

## 4. P1 — после первых реальных заказов

Google Maps/Routes/Places за `MapProvider` / `GeocodingProvider` / `RoutingProvider` · online payments · push · PWA · SMS fallback · share tracking · promocodes · partner earnings/balance · receipts · support/disputes/refunds · service zones · i18n

---

## 5. P2 — масштаб

Insurance API · Fleet API · White-label · corporate billing · subscription roadside · predictive demand · advanced/AI dispatch · fraud · dynamic pricing · multi-country/currency · multi-map providers

---

## 6. SEO / публичный слой (п.5 плана)

Сейчас `site:pomich.help` пуст — SPA почти не отдаёт контент краулеру.

Целевая схема:

```text
pomich.help
     │
 ┌───┴───┐
 │       │
Marketing   App
Next.js     React (текущий)
 │           │
 └─────┬─────┘
       │
    FastAPI
       │
 PostgreSQL/PostGIS (+ Redis для live presence)
```

Публичные URL: `/`, `/evakuator`, `/akumulyator`, `/zamina-kolesa`, `/dostavka-palnogo`, `/cities/uzhhorod|lviv|kyiv`, `/partner`, `/about`, `/safety`  
CTA на страницах открывает App / Telegram Mini App.

**Не** переписывать текущий React-app целиком ради SEO.

---

## 7. Open Core vs Cloud

**Открывать:** API contracts, order FSM, dispatch core, presence, PostGIS matching, Docker, basic web client.  
**Не открывать:** KYC, payments, advanced dispatch, fraud, analytics, fleet, white-label, SLA, insurance, Google commercial, AI optimize.

---

## 8. Не делать сейчас

❌ AI-чат на Home · сложная подписка · 30 типов помощи · свой навигатор · соцсеть · крипта · gamification · native apps · микросервисы ради микросервисов · аукцион цен партнёров (OLX-эффект)

---

## 9. Production Sprint (ориентир)

| Неделя | Фокус |
|--------|--------|
| 1 | Client emergency UX + design system |
| 2 | Partner onboarding + KYC |
| 3 | Dispatch scoring + tracking + NO_PROVIDER |
| 4 | Admin ops + reliability |
| 5 | SEO/Next public + PWA + map providers abstraction |
| 6 | Payments scaffold + pilot harden + 100 заявок |

**Цель пилота:** один город, 10–20 живых партнёров, 100 реальных заявок — только потом dynamic pricing / AI / экспансия.

---

## 10. Связанные документы

- Экран-за-экраном ТЗ: [`POMICH_1_0_SCREENS.md`](./POMICH_1_0_SCREENS.md)
- Манифест продукта: [`POMICH_MANIFESTO.md`](./POMICH_MANIFESTO.md)
- Предыдущий план: [`plan/IMPLEMENTATION_ROADMAP.md`](./plan/IMPLEMENTATION_ROADMAP.md)
