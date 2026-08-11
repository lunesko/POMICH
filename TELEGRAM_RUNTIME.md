# POMICH Telegram Runtime

Local development uses long polling. Do not point Telegram webhooks at
`localhost`, `127.0.0.1`, or the local Vite port.

## Environment

Use backend-only variables:

```bash
TELEGRAM_BOT_TOKEN=123456:replace-me
TELEGRAM_MODE=polling
WEB_APP_URL=
```

`WEB_APP_URL` is optional locally. Set it only to a public HTTPS URL when the
POMICH web app is exposed through a tunnel or deployment.

## Diagnostics

```bash
python -m bot.telegram_bot doctor
```

This prints the bot id, username, webhook URL, pending update count, and last
webhook error. It never prints the token.

## Start Polling

```bash
python -m bot.telegram_bot
```

Expected startup log:

```text
POMICH Telegram bot starting
Mode: polling
Bot: @pomich_help_bot id=...
Webhook: url=<empty> pending_update_count=...
Polling started
```

Only one polling worker may run for the same bot token.
