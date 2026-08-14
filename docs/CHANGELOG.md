# Changelog / Журнал змін

Описи змін для користувачів і партнерів POMICH. Technical file lists live in git history.

---

## 2026-08-14

### Швидший вхід за кодом (OTP) / Faster login codes

**UA.** Надсилання коду підтвердження більше не чекає відповіді Telegram (раніше це могло займати близько хвилини). Код одразу зберігається, повідомлення йде у фоні з коротким таймаутом. Перевірка коду дивиться лише в базу — без запитів до Telegram.

**EN.** Sending an OTP no longer waits on Telegram HTTP (previously up to ~60s). The code is stored immediately and delivered in the background. Confirm/verify is database-only and never calls Telegram.

### Карта без закритих заявок / Closed orders leave the map

**UA.** Завершені та скасовані заявки більше не лишаються пінами на карті партнера. На карті лише відкриті заявки в пошуку виконавця.

**EN.** Completed and cancelled orders no longer stay as map pins. Partner duty map shows only open, searching requests.
