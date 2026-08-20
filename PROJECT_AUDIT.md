# POMICH — полный аудит проекта

**Дата:** 2026-08-20  
**База:** ветка `main` (`9a31995`) ≈ текущий прод  
**Прод:** https://pomich.help  
**Стек:** React 19 + Vite · FastAPI · Postgres/PostGIS · 2 Telegram-бота  

> Файл можно скопировать целиком. Это **продуктовый + технический** аудит: заявки, регистрация, роли, диспетчеризация, realtime, кабинет, Telegram — и отдельно безопасность/ops.

---

## 0. Вердикт одной страницей

| Область | Состояние на `main` | Комментарий |
|---------|---------------------|-------------|
| Клиент: регистрация → OTP → заявка | Работает в UI | Сервер на `main` слабее UI (заказ без verified/session возможен) |
| Партнёр: регистрация → линия | Работает частично | Слабые gates: можно на линию без полного профиля/OTP (обход в UI) |
| Жизненный цикл заявки | Ядро есть | Дыры: мёртвый DetailsStep, idle после accept, restore экрана партнёра |
| Диспетчеризация | Работает | Без Telegram push — только poll; после истечения офферов заказ «висит» |
| Role switch клиент↔партнёр | Ломается UX | Повторная регистрация/OTP; incomplete partner на duty |
| Безопасность API | Критичные дыры | IDOR заказа, open nearby, open webhooks — закрыто в PR #8 (не смержен) |
| Ops/deploy | Рискованно | Хардкод секретов в `deploy.py` |

**Открытые PR с уже сделанными фиксами (ещё не в `main`):**

| PR | Что чинит |
|----|-----------|
| **#8** | Auth: IDOR, nearby, webhooks, create order session, partner completeness, hydrate |
| **#7** | Perf: OTP/login, cabinet, accept UI, Telegram outbound queue |
| **#6** | Incomplete partner: роль/OTP/профиль |
| **#5** | Кириллица в номере авто |
| **#4** | Партнёр→клиент без повторной регистрации |
| **#3** | 15 мин idle на `accepted` → автоскасування |
| **#2** | Restore активного заказа партнёра после reload |

**Рекомендуемый порядок ship:** #8 → #4/#6 → #3 → #2 → #5 → #7, затем остаточный backlog из этого аудита.

---

## 1. Карта продукта (как должно работать)

```
Landing
  ├─ Клиент ─► Реєстрація / Вхід (OTP) ─► Карта послуг
  │              └─ Заявка: сервіс → локація → [пункт] → review
  │                   └─ searching → accepted → price_confirmed
  │                        → en_route → arrived → in_progress → completed
  │
  ├─ Партнер ─► Реєстрація профілю (авто/номер/послуги) ─► OTP
  │              └─ Duty (на лінії) ─► офери / pin на карті
  │                   └─ accept+ціна → очікування confirm → статуси
  │
  └─ Admin ─► ?role=admin / #admin ─► клієнти / партнери / заявки / імпорт
```

**Статуси заявки (сервер FSM):**  
`draft` → `searching` → `accepted` → `price_confirmed` → `en_route` → `arrived` → `in_progress` → `completed` | `cancelled`

---

## 2. Сценарии: регистрация и вход

### 2.1 Клиент — новый

| Шаг | UI | API |
|-----|-----|-----|
| Landing «Потрібна допомога» / роль «Я клієнт» | `LandingPage` → `OnboardingGate` → `ClientRegistrationScreen` | guest/telegram session |
| Ім'я + місто + телефон UA | валідація на клієнті | `PATCH/POST` profile |
| OTP | `OtpVerificationPanel` | verify send/confirm |
| Готовність до заявки | `isCustomerReadyForOrder` = профіль + `verified` | — |

**Що працює:** happy path web + Telegram Mini App (`tg-{id}`), duplicate phone → 409 + restore, name-mismatch захист від змішування акаунтів.

**Проблеми:**

| Проблема | Вага | Деталі |
|----------|------|--------|
| Сервер не вимагає verified phone для `POST /orders` (`main`) | **Major** | UI блокує, API — ні. PR #8 вимагає session |
| Місто обов'язкове в формі, але не в `isCustomerProfileComplete` | Minor | Неконсистентність checklist |
| Після OTP якщо немає customerToken — можна «зависнути» поза аппом | Major | #8 покращує recovery |
| OTP confirm без ліміту спроб | Major | 6 цифр, brute-force |

### 2.2 Клиент — вхід по телефону

`ClientLoginScreen` → send/confirm → session.  
**Проблема:** `404 customer_not_found` vs success = enumeration номерів.

### 2.3 Партнер — реєстрація

| Шаг | UI | Вимоги |
|-----|-----|--------|
| Роль партнер / «Надаю послуги» | `ProviderFlow` → `ProviderRegistrationStep` | ім'я, телефон, місто, марка/модель, номер авто, ≥1 послуга, радіус |
| Збереження | PATCH profile | `registeredAt` |
| OTP | step `verify` | phone verified |
| Duty | карта + toggle | online + heartbeat 12s |

**Проблеми на `main`:**

| Проблема | Вага | Деталі |
|----------|------|--------|
| `isPartnerRegisteredAndCompleted` = `registeredAt` **АБО** (flag + будь-яке vehicle) — **без** обов'язкового plate/specialties | **Major** | можна вважати «завершеним» неповний профіль |
| `providerCanGoOnline` обходить OTP: достатньо customerToken або bootstrap phone | **Blocker** | вихід на лінію без реального OTP |
| Кабінет `isProviderProfileIncomplete` **ігнорує plate** | Major | Flow ≠ Cabinet |
| Сервер presence перевіряє лише `registeredAt` + verified — **не** plate/specialties | Major | UI/server роз'їзд |
| `pomichPartnerRegistered:*` в localStorage переживає logout | Major | хибний «returning partner» |
| Кирилиця в номері авто | Major | фікс у PR #5/#8 |

### 2.4 Партнер — phone already registered

Працює: 409 → «Увійти за цим номером» → phone login. Добре.

---

## 3. Сценарії: заявка (замовлення)

### 3.1 Happy path клієнта

1. Карта home → вибір послуги (якщо профіль готовий)  
2. Локація (occupied zones блокуються) → destination (якщо треба) → review  
3. `POST /orders` → статус `searching` + auto `dispatch_order`  
4. `SearchingStep`: очікування, retry, cancel  
5. Партнер прийняв → підтвердження ціни / cancel  
6. Tracking: en_route → arrived → in_progress → completed + review  

**Файли:** `CustomerFlow.tsx`, `OrderTerminalStep.tsx`, `bot/routers/orders.py`, `bot/order_store.py`

### 3.2 Happy path партнера

1. На лінії → офер (poll ~4s / SSE / Telegram push) або pin nearby (~8s)  
2. Accept + ціна (обов'язково) — first-wins  
3. Чекає `price_confirmed`  
4. Ланцюг статусів CTA → completed + review → назад на duty  

**Файли:** `ProviderFlow.tsx`, `IncomingOfferStep.tsx`, `OrderRequestSheet.tsx`

### 3.3 Проблеми заявки

| Проблема | Вага | Деталі |
|----------|------|--------|
| **`DetailsStep` мертвий** | Major | Є компонент + `case "details"`, але нічого не ставить `screen === "details"`. Завжди default `vehicleState = "Авто заводиться"` — клієнт не описує стан авто |
| **ArrivedStep бреше** | Major | Текст про підтвердження завершення, CTA викликає лише `setScreen("in_progress")` **без API**. Завершення веде партнер |
| Немає idle timeout на `accepted` | **Major** | Якщо клієнт не підтвердив ціну — партнер чекає вічно. PR **#3** (15 хв) |
| Restore екрана партнера після reload | Major | PR **#2** |
| Після протухання всіх оферів заказ лишається `searching` | Major | Поки клієнт не натисне retry — «тиха смерть» диспатчу |
| Cancel дозволений глибоко (arrived/in_progress) | Minor | Політика продукту неясна |
| `GET /orders/{id}` відкритий на `main` | **Blocker** | Будь-хто з id читає заявку. PR **#8** |
| Nearby pins публічні на `main` | **Major** | Живі заявки на карті без auth. PR **#8** |
| SSE/WS order channels без auth на `main` | **Blocker** | Стрім чужої заявки. PR **#8** |

### 3.4 Диспетчеризація (як підбираються партнери)

Критерії: `online`, verified, свіжий presence (<60s), specialty match, в межах `serviceRadiusKm`, без `assignedOrderId`.

Параметри: радіуси `SEARCH_RADIUS_STEPS_KM` (default 5,10,20,40), max оферів 5, TTL офера ~90s.

| Проблема | Вага |
|----------|------|
| Немає Telegram user id → **немає push**, лише in-app poll | Major |
| Redispatch при go-online є, але мовчки якщо specialty/radius не збігаються | Minor |
| Presence TTL 60s / heartbeat 12s: фон вкладки >60s → випадає з диспатчу | Minor (очікувано, але UX-сюрприз) |

---

## 4. Role switch (клієнт ↔ партнер)

| Напрям | Очікування | Факт на `main` | Вага |
|--------|------------|----------------|------|
| Клієнт → партнер | self-session + реєстрація/дозаповнення | Працює; incomplete може вийти на лінію (слабкі gates) | Major |
| Партнер → клієнт | Той самий акаунт, без повторної реєстрації | Часто **порожня реєстрація / другий OTP** | **Blocker** |
| Збереження identity | `preservedAccount`, preferredRole | Задумано правильно | — |
| localStorage flag | — | `pomichPartnerRegistered` бреше після logout | Major |

**Фікси:** PR **#4**, **#6**, частково **#8** (`hydrateClientFromPartner`).

---

## 5. Кабінети та карта

### 5.1 ClientCabinet
Профіль, OTP якщо unverified, історія, зміна ролі, logout — ок.

### 5.2 ProviderCabinet
Профіль, duty, офери, історія.  
**Проблема:** критерій «incomplete» ≠ ProviderFlow (немає plate) → duty toggle в кабінеті може розійтися з картою.

### 5.3 Карта клієнта
Directory + online партнери, місто / вся UA, occupied overlay, gate послуг по профілю.  
**Проблема:** публічні телефони партнерів на `/map/providers`.

### 5.4 Карта партнера
Self pin + searching pins + sheet. Completed/cancelled pins вже сховані (недавній фікс на main) — добре.

---

## 6. Telegram Mini App (2 боти)

| Бот | Аудиторія | Entry |
|-----|-----------|--------|
| `@pomich_ua_bot` | клієнт | `?role=customer&tgBot=customer` |
| `@pomich_help_bot` | партнер | `?role=provider&tgBot=provider` |

Deep links: `screen=duty|offers|verify|cabinet|history`.

| Проблема | Вага |
|----------|------|
| Webhook без secret на `main` | Blocker (sec) → #8 |
| Немає TG link у партнера → тихо пропускає офери | Major |
| Текст TG «відкрий кабінет», а ціну треба в Mini App | Minor |
| `start.sh` polling лише на `TELEGRAM_BOT_TOKEN`, dual-bot vars можуть ігноруватись | Minor |

---

## 7. Admin

Вхід: `?role=admin` / `/#admin` (працює).  
Long-press логотипу на лендінгу **задокументований, але не wired** — Minor.

Очередь verification vs OTP-auto-`verified`: багато партнерів стають verified без admin docs — process mismatch (Minor).

---

## 8. Realtime

Ланцюг: **WebSocket → SSE → poll** (клієнт ~2.5s, офери ~4s).

| Проблема | Вага |
|----------|------|
| Order events/WS без auth (`main`) | Blocker → #8 |
| `?access_token=` в URL для EventSource | Minor (логи/Referer) |
| Після 3 fail WS → постійно SSE; якщо обидва fail — poll (стійко) | ок |

---

## 9. Матриця UI vs сервер (консистентність)

| Правило | UI (`main`) | Сервер (`main`) | Збіг? |
|---------|-------------|-----------------|-------|
| Клієнт verified перед заявкою | Так | Ні | **Ні** |
| Customer session для create | М'яко | Опційно | **Ні** (#8 так) |
| Партнер plate/specialties перед online | Слабо | Лише registeredAt+verified | **Ні** |
| Партнер OTP перед online | Обхідний | Так (verified flag) | **Ні** |
| FSM статусів заявки | Йде слідом | Жорсткий | Майже |
| Accept + ціна | Обов'язково | Обов'язково | Так |
| Price confirm перед en_route | Так | Так | Так |
| Nearby searching pins | Партнер UI | Public GET | **Ні** (#8) |
| Order event stream | З токеном опційно | Open | **Ні** (#8) |

---

## 10. Безпека (скорочено; деталі лишаються актуальними)

### Critical (на `main`)
1. **IDOR** `GET /orders/{id}` — без auth  
2. **Guest session mint** — клієнт може вибрати `guest-*` id → захват  
3. **Shared `POMICH_PROVIDER_TOKEN`** → сесія будь-якого providerId  
4. **Хардкод секретів у `deploy.py`** (`pomich-*-secret-2026`, DB pass, HTTP pilot)  
5. **Telegram webhooks без secret**

### High
- CORS `*.trycloudflare.com` завжди з credentials  
- OTP confirm без lockout; phone-login enumeration  
- Паролі admin/provider: plaintext / unsalted sha256, без lockout  
- Телефони на публічній карті  
- Токени в query (`providerToken`, `access_token`)  
- Uzhhorod import приймає raw admin bootstrap header  

### Після merge #8 закривається
IDOR заказа, nearby auth, webhook secret, admin-only `/providers`, create order session, жорсткіший partner completeness (частково).

**Не закриває #8:** guest mint, shared provider token, deploy.py defaults, map phones, Cloudflare CORS, OTP lockout.

---

## 11. Ops / CI

| Тема | Оцінка |
|------|--------|
| Docker multi-stage, healthcheck, postgres healthy | Добре |
| Миграції ledger | Добре |
| CI: pytest + vitest + tsc + build + PostGIS | Добре |
| Node 20 у CI vs 22 у Docker/mise | Вирівняти |
| Health без DB readiness | Додати |
| `deploy.py` secrets + root SSH + AutoAddPolicy | Переписати |
| `.env.example` з реальним IP | Placeholder |

---

## 12. Пріоритетний backlog (продукт + безпека)

### P0 — зараз
1. Merge + deploy **PR #8**  
2. Ротація секретів, якщо ставились з `deploy.py` defaults; прибрати хардкод  
3. Закрити обхід OTP партнера / вирівняти completeness (якщо щось лишилось після #8)

### P1 — UX заявок і ролей
4. Merge **#4/#6** (партнер↔клієнт без повторної реєстрації)  
5. Merge **#3** (idle 15 хв на accepted)  
6. Merge **#2** (restore активного заказа партнера)  
7. Merge **#5** (кирилиця номера)  
8. Підключити або прибрати **DetailsStep**; виправити текст/CTA **ArrivedStep**  
9. Авто-retry / повідомлення коли всі офери згоріли, а статус ще `searching`  
10. Єдиний `isPartnerProfileComplete` (Flow + Cabinet + **сервер presence** з plate/specialties)  
11. Чистити `pomichPartnerRegistered` на logout  

### P2 — зміцнення
12. Guest mint тільки server UUID  
13. Сузити/прибрати shared provider token  
14. Телефони з публічної карти (live partners)  
15. OTP lockout + anti-enum  
16. Cloudflare CORS off у production  
17. Rate limits, security headers, deep health, Node align  

### P3 — polish
18. Admin logo long-press або прибрати з docs  
19. Місто в customer readiness  
20. Маскувати номер авто клієнту до en_route (опційно)

---

## 13. Чеклист ручного ретесту (після merge хвилі PR)

**Клієнт**
- [ ] Нова реєстрація → OTP → карта послуг  
- [ ] Вхід по телефону  
- [ ] Заявка tow з destination + без  
- [ ] Searching → accept партнера → confirm ціни → статуси до completed + review  
- [ ] Cancel на searching і на accepted  
- [ ] Occupied zone не дає створити заказ  

**Партнер**
- [ ] Повна реєстрація (plate обов'язковий) → OTP → «На лінії»  
- [ ] Incomplete профіль **не** пускає на лінію  
- [ ] Офер accept з ціною → wait confirm → ланцюг статусів  
- [ ] Reload під час активного заказа повертає той самий крок  
- [ ] Idle 15 хв на accepted → автоскасування (після #3)  
- [ ] phone_already_registered → login CTA  

**Ролі**
- [ ] Клієнт → партнер (linked) без втрати клієнтського профілю  
- [ ] Партнер → клієнт **без** повторної реєстрації/OTP якщо вже verified  
- [ ] Logout чистить partner-registered flags  

**Telegram**
- [ ] Customer bot і provider bot окремі entry  
- [ ] Deep link `screen=offers` / `duty`  
- [ ] Webhook з secret відхиляє без header  

**Негативні (безпека)**
- [ ] Анонімний `GET /orders/{id}` → 401  
- [ ] Анонімний nearby → 401  
- [ ] Webhook без secret → 401/403  

---

## 14. Індекс ключових файлів

| Зона | Шляхи |
|------|--------|
| Shell / ролі | `src/App.tsx`, `src/CustomerApp.tsx`, `src/telegram.ts` |
| Онбординг | `src/components/onboarding/*`, `landing/LandingPage.tsx` |
| Заявка клієнта | `src/components/customer/CustomerFlow.tsx` |
| Партнер / duty / офери | `src/components/provider/ProviderFlow.tsx`, `IncomingOfferStep.tsx` |
| Кабінети | `src/components/cabinet/*` |
| Адмін | `src/components/admin/AdminFlow.tsx` |
| API / realtime | `src/api/client.ts`, `src/lib/realtime.ts`, `src/lib/orderStatus.ts` |
| Backend | `bot/routers/{orders,providers,auth,customers,events,ws,telegram,admin}.py` |
| FSM / dispatch | `bot/order_store.py` (`ORDER_TRANSITIONS`, `dispatch_order`, presence) |
| UX-док | `docs/UX_UI_CURRENT_SCENARIOS.md`, `docs/TELEGRAM_TWO_BOTS.md` |

---

## 15. Підсумок

Продукт **живе end-to-end**: клієнт створює заявку, партнер бере в роботу, ціна й статуси доходять до completed. Найбільші продуктовые дірки зараз — **слабкі gates партнера на `main`**, **role switch партнер→клієнт**, **мертвий DetailsStep / брехливий Arrived**, **idle після accept**, **тихий кінець диспатчу**, плюс **критична API-безпека** (IDOR/nearby/webhooks), уже майже зібрана в PR #8.

**Практичний наступний крок:** смержити хвилю відкритих PR (#8, #4/#6, #3, #2, #5) і пройти чеклист §13 на проді.

---

*Аудит по коду + відкритих PR. Не замінює повний QA на пристроях / Telegram; для безпеки додатково див. секцію 10.*
