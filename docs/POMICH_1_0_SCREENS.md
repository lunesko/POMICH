# POMICH 1.0 — ТЗ экранов (Client · Partner · Admin)

**Для Cursor/Claude:** реализовывать экран целиком, не добавлять побочных фич.  
**Язык UI:** украинский. **Mobile-first**, стрессовый emergency UX.

---

## A. CLIENT

### A1. Home — «Що сталося?»
- Карта = фон/контекст, не главный UI.
- Заголовок: короткий («Потрібна допомога?»).
- **4 крупные карточки** (2×2): Евакуатор · Не заводиться · Пробило колесо · Закінчилось пальне.
- Ниже текст-кнопка: **Інша проблема** → `lockout` / `mechanic` (список).
- Не требовать полный профиль до выбора проблемы (OTP/телефон — на шаге подтверждения заказа).
- Peek sheet: те же 4 карточки компактно.

### A2. Location — «Де ви знаходитесь?»
- Авто: «📍 Місце визначено» + reverse-geocode адрес.
- CTA: **Підтвердити місце** · **Вказати інше** (карта + pin вручную).
- Ошибка GPS: retry + «відкрити налаштування».

### A3. Details (минимум)
- Авто: марка, модель (год optional).
- Что случилось: 4–5 чипов по услуге.
- Для `tow`: «Куди доставити?» (обязательно).
- Без анкеты на 15 полей.

### A4. Price confirm
- Показать: услуга, км, **орієнтовно X–Y ₴**.
- CTA: **Знайти допомогу**.
- Без аукциона офферов от партнёров в 1.0.

### A5. Searching
- Отдельный режим: карта + пульс зоны.
- Текст: «Шукаємо допомогу поруч» · «Перевіряємо N партнерів» · «Зазвичай до 2 хв».
- Расширение радиуса: 5 → 10 → 20 → 40 км (сервер/dispatch).
- CTA: **Скасувати пошук**.

### A6. No provider
- Не крутить поиск бесконечно.
- «На жаль, зараз не знайшли партнера поруч.»
- CTA: Розширити пошук · Зателефонувати диспетчеру · Скасувати.

### A7. Match found
- «Допомога вже їде».
- Фото, імʼя, ⭐ рейтинг · N замовлень, авто, номер, ETA.
- Карта движения.
- Подзвонити · Написати · Поділитися поїздкою (P1 share URL).

### A8. Arrived / Work / Done
- Партнер: «Я на місці» → клиент видит «Партнер прибув».
- «Розпочати роботу» фиксируется сервером.
- Завершение: сумма · оплата (cash ok) · ★★★★★ + комментарий.

### A9. Auth
- Телефон → OTP → заказ; аккаунт создаётся по ходу.
- Google login — optional later.
- Запрещено: регистрация с паролем/email до вызова помощи.

### A10. Emergency gate (ДТП)
- «Є постраждалі?» → Так → показать **112**; POMICH только про авто.

---

## B. PARTNER

### B1. Home
- Offline: большая **Вийти на лінію**.
- Online: 🟢 Ви на лінії · сьогодні ₴ · заказы · рейтинг.
- Статусы: ONLINE / BUSY / OFFLINE / PAUSED.

### B2. Onboarding + KYC (P0)
1. Телефон 2. ФИО/ФОП 3. Фото 4. Документы 5. Авто 6. Госномер  
7. Услуги (capabilities) 8. Район 9. Банк  
→ «⏳ Перевіряємо» → «✓ Перевірений партнер»  
Без verified — нельзя принимать real-money заказы (пилот: admin approve).

### B3. Offer card (15s timeout)
```
🚛 Евакуатор
3.2 км · Volvo V60 · Не заводиться
До клієнта ~7 хв · Заказ ~950 ₴
[Прийняти]  [Відхилити]
```
Timeout → следующий в очереди dispatch.

### B4. Active job
- Маршрут к клиенту · Я на місці · Розпочати · Завершити · заработок в истории.

### B5. Trust на публичной карточке
- ✓ Особу підтверджено · ✓ Авто підтверджено · рейтинг · N заказов · дата реєстрації.

---

## C. ADMIN / DISPATCHER (Operations Center)

### C1. Live map
- 🟢 free · 🟠 busy · 🔴 problem orders.

### C2. Orders board
Статусы: SEARCHING · OFFERED · ASSIGNED · EN_ROUTE · ARRIVED · IN_PROGRESS · COMPLETED · CANCELLED · FAILED · NO_PROVIDER_FOUND

### C3. Actions
Assign · Reassign · Call client/partner · Cancel · Change price · Refund · Block partner · Audit log.

### C4. North Star widget
Крупно: **Допомогли N водіям** + SAR / TTM / TTA.

---

## D. Dispatch Engine (сервер, не UI)

```
score = distance + ETA + rating + acceptance_rate
      + completion_rate + service_match + vehicle_match + partner_status
```
- Оффер только при `capability` match.
- Presence heartbeat → Redis geo (live) + PostGIS (persist).
- Pricing module отдельно от Order; PaymentProvider статусы: PENDING/AUTHORIZED/PAID/FAILED/REFUNDED (cash = PAID manual).

---

## E. SEO public (Next.js, вне SPA)

Страницы: `/evakuator`, `/akumulyator`, `/zamina-kolesa`, `/dostavka-palnogo`, `/cities/{slug}`, `/partner`, `/about`, `/safety`  
Каждая: H1, текст, FAQ, CTA → App/Telegram.  
`robots.txt`, `sitemap.xml`, OG, JSON-LD LocalBusiness/Service.

---

## F. Критерии готовности экрана

- [ ] Один главный вопрос на экран
- [ ] CTA ≥ 48px высоты, читается ночью
- [ ] Ошибки и empty states на украинском
- [ ] Сервер — источник правды по статусу заказа
- [ ] Нет аукциона цен и нет 30 услуг на Home
