# POMICH Telegram Runtime

Local development uses long polling. Do not point Telegram webhooks at
`localhost`, `127.0.0.1`, or the local Vite port.

Production uses **two bots** (customer + provider) on one origin — see
[`docs/TELEGRAM_TWO_BOTS.md`](docs/TELEGRAM_TWO_BOTS.md)
(full checklist/spec: [`docs/TELEGRAM_TWO_BOTS_SPEC.md`](docs/TELEGRAM_TWO_BOTS_SPEC.md)).

## Environment

Preferred (two bots):

```bash
TELEGRAM_CUSTOMER_BOT_TOKEN=123456:customer-token
TELEGRAM_PROVIDER_BOT_TOKEN=123456:provider-token
TELEGRAM_CUSTOMER_WEB_APP_URL=https://pomich.help/?role=customer&tgBot=customer
TELEGRAM_PROVIDER_WEB_APP_URL=https://pomich.help/?role=provider&tgBot=provider
TELEGRAM_MODE=webhook
WEB_APP_URL=https://pomich.help
```

Local single-bot fallback:

```bash
TELEGRAM_BOT_TOKEN=123456:replace-me
TELEGRAM_MODE=polling
WEB_APP_URL=https://pomich.help
POMICH_CUSTOMER_SESSION_SECRET=local-customer-session-secret
```

`WEB_APP_URL` is optional locally. Set it only to a public HTTPS URL when the
POMICH web app is exposed through a tunnel or deployment.

The Mini App calls `/api/auth/customer/telegram/session` with Telegram
`initData` and optional `X-POMICH-Telegram-Bot`. FastAPI verifies that
`initData` against the matching bot token, links the Telegram user to a
`tg-*` customer profile, and returns a customer bearer session.

## Diagnostics

```bash
python -m bot.telegram_bot doctor
```

This prints each configured bot id, username, webhook URL, pending update
count, and last webhook error. It never prints tokens.

## Start Polling

```bash
python -m bot.telegram_bot
```

Expected startup log (one block per configured token):

```text
POMICH Telegram bot starting
Mode: polling
Bot kind: customer @pomich_ua_bot id=...
Webhook: url=<empty> pending_update_count=...
Polling started
```

Only one polling worker may run for the same process lock.

## Production webhooks / menu

```bash
python scripts/ops/telegram_set_webhooks.py --origin https://pomich.help
```
