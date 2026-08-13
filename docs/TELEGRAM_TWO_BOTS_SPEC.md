# POMICH Telegram: two-bot split spec

## Decision

Split Telegram entry points into two public bots, but keep one POMICH product:

| Bot | Audience | Purpose |
| --- | --- | --- |
| `@pomich_ua_bot` | Customers | Create roadside-help orders, track status, manage client profile |
| `@pomich_help_bot` | Partners/providers | Partner onboarding, verification, go online/offline, receive and accept offers |

Do not create two separate frontends or APIs. Both bots open the same Web/PWA frontend and talk to the same FastAPI backend through the same public origin.

Target production origin:

```text
https://pomich.help
https://pomich.help/api/*
```

Recommended Web App links:

```text
Customer bot: https://pomich.help/?role=customer&tgBot=customer
Partner bot:  https://pomich.help/?role=provider&tgBot=provider
```

For staging, use the same pattern:

```text
https://staging.pomich.help/?role=customer&tgBot=customer
https://staging.pomich.help/?role=provider&tgBot=provider
```

## Current code gap

The current implementation is still single-bot oriented:

- one backend token: `TELEGRAM_BOT_TOKEN`
- one Web App URL: `WEB_APP_URL`
- one webhook endpoint: `/telegram/webhook`
- one initData verifier based on the single token
- notification sending uses one `TelegramBotClient`

The split must make the bot identity explicit everywhere it matters:

- token selection
- initData verification
- webhook routing
- menu buttons
- command lists
- notification channel

## Environment variables

Replace the single-bot production config with two backend-only tokens.

```bash
TELEGRAM_CUSTOMER_BOT_USERNAME=pomich_ua_bot
TELEGRAM_CUSTOMER_BOT_TOKEN=123456:customer-token
TELEGRAM_CUSTOMER_WEB_APP_URL=https://pomich.help/?role=customer&tgBot=customer

TELEGRAM_PROVIDER_BOT_USERNAME=pomich_help_bot
TELEGRAM_PROVIDER_BOT_TOKEN=123456:provider-token
TELEGRAM_PROVIDER_WEB_APP_URL=https://pomich.help/?role=provider&tgBot=provider

TELEGRAM_MODE=webhook
WEB_APP_URL=https://pomich.help
POMICH_CORS_ORIGINS=https://pomich.help
```

Keep `TELEGRAM_BOT_TOKEN` only as a backward-compatible local fallback. Do not expose Telegram tokens with a `VITE_` prefix.

## Backend changes

### 1. Bot config

Add a small Telegram bot registry:

```text
customer -> @pomich_ua_bot   -> TELEGRAM_CUSTOMER_BOT_TOKEN -> customer Web App URL
provider -> @pomich_help_bot -> TELEGRAM_PROVIDER_BOT_TOKEN -> provider Web App URL
```

Recommended helpers:

```python
get_telegram_bot_config(kind: "customer" | "provider")
get_telegram_bot_configs()
get_telegram_bot_token(kind)
get_telegram_web_app_url(kind)
```

`TelegramBotClient` should accept `kind`:

```python
TelegramBotClient(kind="customer").send_message(...)
TelegramBotClient(kind="provider").send_message(...)
```

### 2. initData verification

Telegram `initData` is signed with the token of the bot that opened the Web App. Therefore:

- customer Web App sessions must verify against `TELEGRAM_CUSTOMER_BOT_TOKEN`
- partner Web App sessions must verify against `TELEGRAM_PROVIDER_BOT_TOKEN`
- `tgBot=customer|provider` from the URL is only a hint, not trusted auth

Recommended verifier behavior:

```text
verify_telegram_init_data_any_bot(initData, hintedBotKind?)
  1. if hintedBotKind is present, try that token first
  2. if it fails or no hint is present, try both configured tokens
  3. return verified payload plus botKind
  4. reject if no configured token validates the signature
```

Return shape:

```json
{
  "botKind": "customer",
  "user": {
    "id": 829741830,
    "first_name": "Vitalii",
    "username": "example"
  }
}
```

Important: Telegram user identity is one human identity. The same Telegram user may open both bots. Store the person once as `tg-{telegram_user_id}`, but store which bot/channel was used for notifications.

### 3. API routes

Public browser calls stay same-origin:

```text
/api/auth/customer/telegram/session
/api/telegram/customer/webhook
/api/telegram/provider/webhook
/api/orders
/api/providers/{id}/presence
```

Backend routes behind the `/api` reverse proxy can be:

```text
POST /auth/customer/telegram/session
POST /telegram/customer/webhook
POST /telegram/provider/webhook
GET  /telegram/session/{chat_id}
```

`/auth/customer/telegram/session` should accept:

```text
X-Telegram-Init-Data: <raw initData>
X-POMICH-Telegram-Bot: customer|provider
```

The second header is a routing hint only. The backend still verifies the signature against the correct bot token.

Response should include:

```json
{
  "customerId": "tg-829741830",
  "accessToken": "...",
  "preferredRole": "customer",
  "telegramBotKind": "customer",
  "account": {}
}
```

For provider bot sessions:

```json
{
  "customerId": "tg-829741830",
  "accessToken": "...",
  "preferredRole": "provider",
  "telegramBotKind": "provider",
  "providerAccount": {
    "linked": true,
    "providerId": "provider-oleksandr",
    "verificationStatus": "verified"
  }
}
```

Telegram identity alone must not grant provider permissions. Provider API access still requires a linked provider account/session and verification rules.

### 4. Webhooks

Use two webhook URLs:

```text
https://pomich.help/api/telegram/customer/webhook
https://pomich.help/api/telegram/provider/webhook
```

Each endpoint should call the same update handler with explicit bot kind:

```python
handle_update(payload, bot_kind="customer")
handle_update(payload, bot_kind="provider")
```

This keeps messages, keyboards, and notifications role-specific.

### 5. Notifications

Send customer notifications through `@pomich_ua_bot`:

- order created
- partner accepted
- price proposed
- price confirmed
- provider en route
- provider arrived
- work started
- completed
- cancelled
- review prompt

Send provider notifications through `@pomich_help_bot`:

- new dispatch offer
- offer expired
- offer lost because another partner accepted first
- accepted successfully
- customer confirmed price
- customer cancelled
- status reminder
- review prompt

Do not send provider offers from the customer bot.

## Frontend changes

Extend Telegram context:

```ts
interface TelegramContext {
  isTelegram: boolean
  initData?: string
  chatId?: string
  botKind?: "customer" | "provider"
  user?: TelegramWebAppUser
}
```

Resolve `botKind` from:

1. `?tgBot=customer|provider`
2. Telegram `start_param`
3. fallback from `?role=customer|provider`

Role selection:

```text
@pomich_ua_bot   -> role=customer -> customer order flow
@pomich_help_bot -> role=provider -> partner cabinet/onboarding
```

When creating a Telegram session:

```text
POST /api/auth/customer/telegram/session
X-Telegram-Init-Data: <initData>
X-POMICH-Telegram-Bot: customer|provider
```

The frontend can use `preferredRole` from backend after auth, but role/security decisions remain backend-owned.

## Bot commands

### Customer bot: `@pomich_ua_bot`

Bot menu button:

```text
Text: Викликати допомогу
URL:  https://pomich.help/?role=customer&tgBot=customer
```

Commands:

| Command | Description | Action |
| --- | --- | --- |
| `/start` | Start customer flow | Welcome, open customer Web App |
| `/app` | Open POMICH | Opens customer Web App |
| `/order` | Create help request | Opens customer order screen |
| `/status` | Active order status | Shows latest active order or opens status screen |
| `/profile` | Client profile | Opens client cabinet |
| `/history` | Order history | Opens client history |
| `/cancel` | Cancel active order | Shows confirmation button before API cancel |
| `/support` | Support | Shows support contact/escalation |
| `/help` | Help | Short explanation and Web App button |

`/start` inline buttons:

```text
Викликати допомогу -> Web App customer URL
Мій профіль        -> Web App customer cabinet
Історія            -> Web App customer history
Стати партнером    -> https://t.me/pomich_help_bot?start=partner
```

Suggested `/start` text:

```text
Вітаємо у POMICH.

Якщо авто зупинилося в дорозі, відкрийте заявку - ми знайдемо найближчого перевіреного партнера.
```

### Partner bot: `@pomich_help_bot`

Bot menu button:

```text
Text: Кабінет партнера
URL:  https://pomich.help/?role=provider&tgBot=provider
```

Commands:

| Command | Description | Action |
| --- | --- | --- |
| `/start` | Start partner flow | Welcome, open partner Web App |
| `/app` | Open partner cabinet | Opens provider Web App |
| `/dashboard` | Partner dashboard | Opens provider cabinet |
| `/online` | Go online | Sets provider online if authorized, verified, and profile complete |
| `/offline` | Go offline | Sets provider offline |
| `/offers` | Active offers | Lists active dispatch offers or opens offer screen |
| `/orders` | My orders | Shows active/current orders |
| `/profile` | Partner profile | Opens provider profile |
| `/verify` | Verification | Opens verification/OTP screen |
| `/support` | Partner support | Support/escalation |
| `/help` | Help | Short explanation and Web App button |

`/start` inline buttons:

```text
Кабінет партнера      -> Web App provider URL
Вийти на лінію        -> /online or Web App duty screen
Активні заявки        -> Web App offers
Підтвердити профіль   -> Web App verification
Я клієнт              -> https://t.me/pomich_ua_bot?start=customer
```

Suggested `/start` text:

```text
Вітаємо у партнерському каналі POMICH.

Тут ви проходите перевірку, виходите на лінію та отримуєте заявки від клієнтів поруч.
```

## BotFather / Telegram setup

For both bots:

1. Set name, description, short description.
2. Set commands with the command lists above.
3. Set Web App domain to `pomich.help`.
4. Set menu button:
   - customer bot: `Викликати допомогу`
   - provider bot: `Кабінет партнера`
5. Configure webhook after backend deployment.

Webhook setup examples:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_CUSTOMER_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://pomich.help/api/telegram/customer/webhook","allowed_updates":["message","callback_query"]}'

curl "https://api.telegram.org/bot$TELEGRAM_PROVIDER_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://pomich.help/api/telegram/provider/webhook","allowed_updates":["message","callback_query"]}'
```

Menu button setup examples:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_CUSTOMER_BOT_TOKEN/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d '{"menu_button":{"type":"web_app","text":"Викликати допомогу","web_app":{"url":"https://pomich.help/?role=customer&tgBot=customer"}}}'

curl "https://api.telegram.org/bot$TELEGRAM_PROVIDER_BOT_TOKEN/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d '{"menu_button":{"type":"web_app","text":"Кабінет партнера","web_app":{"url":"https://pomich.help/?role=provider&tgBot=provider"}}}'
```

## Deploy checklist

1. Deploy frontend and backend behind one public HTTPS origin: `https://pomich.help`.
2. Reverse proxy public `/api/*` to FastAPI.
3. Keep browser API requests same-origin. No browser request may go to `localhost`, `127.0.0.1`, or `:8000`.
4. Set exact CORS:

```bash
POMICH_CORS_ORIGINS=https://pomich.help
```

5. Set two Telegram tokens and two Web App URLs.
6. Set webhooks for both bots.
7. Check Telegram Mini App opens without mixed-content or CORS errors.
8. Check deep routes reload correctly:

```text
https://pomich.help/#interface
https://pomich.help/?role=customer&tgBot=customer
https://pomich.help/?role=provider&tgBot=provider
```

## Acceptance tests

Customer bot:

1. Open `@pomich_ua_bot`.
2. Send `/start`.
3. Tap `Викликати допомогу`.
4. Web App opens customer flow.
5. Backend verifies `initData` with the customer bot token.
6. Customer profile `tg-{telegram_user_id}` is created or restored.
7. Customer creates a real order through `/api/orders`.
8. Customer receives status notifications from `@pomich_ua_bot`.

Provider bot:

1. Open `@pomich_help_bot`.
2. Send `/start`.
3. Tap `Кабінет партнера`.
4. Web App opens provider flow.
5. Backend verifies `initData` with the provider bot token.
6. Provider links/creates provider account.
7. Provider completes OTP/profile verification.
8. Provider goes online.
9. Heartbeat reaches FastAPI.
10. Provider receives real dispatch offers from `@pomich_help_bot`.

End-to-end dispatch:

1. Partner A online and verified.
2. Partner B online and verified.
3. Customer creates order from `@pomich_ua_bot`.
4. Both partners receive offers through `@pomich_help_bot`.
5. Partner A accepts.
6. Partner B receives conflict/lost state.
7. Customer sees assigned Partner A.
8. Order moves through `EN_ROUTE -> ARRIVED -> IN_PROGRESS -> COMPLETED`.
9. Customer receives review prompt.

## Release blocker rules

Do not call Telegram production ready until all are true:

- both bot tokens verify `initData`
- both webhook endpoints return `200`
- customer Web App uses only `https://pomich.help/api/*`
- provider Web App uses only `https://pomich.help/api/*`
- no public browser request goes to `localhost`, `127.0.0.1`, or `:8000`
- provider auth is required for provider actions
- Telegram identity alone cannot bypass provider verification
- order notifications use the correct bot for the correct audience
