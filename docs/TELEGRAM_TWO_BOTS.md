# POMICH Telegram: two-bot split

One product, one frontend, one FastAPI backend, one origin (`https://pomich.help`).
Two public Telegram bots:

| Bot | Audience | Web App URL |
| --- | --- | --- |
| `@pomich_ua_bot` | Customers | `https://pomich.help/?role=customer&tgBot=customer` |
| `@pomich_help_bot` | Partners | `https://pomich.help/?role=provider&tgBot=provider` |

## Environment

Backend-only (never `VITE_` for tokens):

```bash
TELEGRAM_CUSTOMER_BOT_USERNAME=pomich_ua_bot
TELEGRAM_CUSTOMER_BOT_TOKEN=123456:customer-token
TELEGRAM_CUSTOMER_WEB_APP_URL=https://pomich.help/?role=customer&tgBot=customer

TELEGRAM_PROVIDER_BOT_USERNAME=pomich_help_bot
TELEGRAM_PROVIDER_BOT_TOKEN=123456:provider-token
TELEGRAM_PROVIDER_WEB_APP_URL=https://pomich.help/?role=provider&tgBot=provider

TELEGRAM_MODE=webhook
TELEGRAM_WEBHOOK_SECRET=generate-a-long-random-secret
WEB_APP_URL=https://pomich.help
POMICH_CORS_ORIGINS=https://pomich.help
```

Local fallback: if the new vars are missing, `TELEGRAM_BOT_TOKEN` + `WEB_APP_URL` still work for a single-bot / polling setup.

## API

- `POST /auth/customer/telegram/session` (+ `/api/...`)
  - Headers: `X-Telegram-Init-Data`, optional `X-POMICH-Telegram-Bot: customer|provider` (hint only)
  - Verifies initData against customer and/or provider bot tokens
  - Same human → `tg-{telegram_user_id}`; response includes `telegramBotKind`, `preferredRole`
  - Provider bot also returns `providerAccount` link summary — **does not** grant provider API permissions
- Webhooks:
  - `POST /telegram/customer/webhook`
  - `POST /telegram/provider/webhook`
  - Legacy `POST /telegram/webhook` → customer handler

## Notifications

- Customer events → customer bot (`@pomich_ua_bot`)
- Provider offers / partner cancel → provider bot (`@pomich_help_bot`)

## Deploy helpers

After tokens + HTTPS origin are live:

```bash
python scripts/ops/telegram_set_webhooks.py --origin https://pomich.help --dry-run --strict
python scripts/ops/telegram_set_webhooks.py --origin https://pomich.help --strict --drop-pending-updates
```

The dry run prints webhook/menu/commands for both bots without calling Telegram API and without printing tokens.
`--strict` requires dedicated customer/provider bot tokens, different tokens for the two bots, and a webhook secret.

BotFather manual checklist:

- `@pomich_ua_bot`: domain `pomich.help`, Web App URL `https://pomich.help/?role=customer&tgBot=customer`.
- `@pomich_help_bot`: domain `pomich.help`, Web App URL `https://pomich.help/?role=provider&tgBot=provider`.
- Commands are set by the script, but the same command lists are visible in `scripts/ops/telegram_set_webhooks.py`.

DNS for `pomich.help` does **not** need to be live to merge this code.
