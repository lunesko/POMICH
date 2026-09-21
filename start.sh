#!/bin/sh
set -e

API_PORT="${API_PORT:-8000}"

if [ "${POMICH_RUNTIME:-production}" = "dev" ]; then
  python3 -m uvicorn bot.fastapi_app:app --host 0.0.0.0 --port "$API_PORT" > /tmp/pomich-api.log 2>&1 &
  exec npm run dev -- --host 0.0.0.0 --port "${PORT:-8443}"
fi

if [ "$(echo "${TELEGRAM_MODE:-polling}" | tr '[:upper:]' '[:lower:]')" = "polling" ]; then
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    python3 -m bot.telegram_bot polling > /tmp/pomich-telegram-bot.log 2>&1 &
    echo "Started Telegram polling worker (pid=$!)"
  else
    echo "TELEGRAM_MODE=polling but TELEGRAM_BOT_TOKEN is empty; skipping bot worker"
  fi
fi

# Keep a single worker: realtime SSE/WS is in-process (see bot/realtime.py).
# Trust only local nginx / docker proxy for X-Forwarded-* (not the open internet).
FORWARDED_ALLOW_IPS="${POMICH_FORWARDED_ALLOW_IPS:-127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16}"
exec python3 -m uvicorn bot.fastapi_app:app --host 0.0.0.0 --port "$API_PORT" --proxy-headers --forwarded-allow-ips="$FORWARDED_ALLOW_IPS" --timeout-keep-alive 5
