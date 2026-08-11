#!/bin/sh
set -e

API_PORT="${API_PORT:-8000}"

if [ "${POMICH_RUNTIME:-production}" = "dev" ]; then
  python3 -m uvicorn bot.fastapi_app:app --host 0.0.0.0 --port "$API_PORT" > /tmp/pomich-api.log 2>&1 &
  exec npm run dev -- --host 0.0.0.0 --port "${PORT:-8443}"
fi

exec python3 -m uvicorn bot.fastapi_app:app --host 0.0.0.0 --port "$API_PORT"
